import { completeJson } from "../_lib/openrouter";
import type {
  CoachContext,
  InsightsRequest,
  InsightsResponse,
} from "../_lib/context";

/**
 * POST /api/insights
 *
 * One combined daily-insights + life-map commentary endpoint. Replaces:
 *   - The hardcoded headline/stat in InsightsView ("Your late-day energy is
 *     real." / "71% more focused work after Asr…")
 *   - The seven hardcoded per-area strings in LifeMapView
 *
 * Caller caches the result for the day (see MizanDashboard InsightsView and
 * LifeMapView effects) so we are not regenerating it on every render. The
 * dateKey in the context lets the client key the cache by Cairo day.
 *
 * Empty state is honest: if there's not enough history yet (no completed
 * tasks, no check-ins, no life-area deltas beyond defaults), we return
 * emptyState: true with a plain "not enough data yet" message instead of
 * inventing a fake statistic.
 */

const SYSTEM_PROMPT = `You are Mizan's insights engine. You receive one user's actual state for today and produce calm, factual commentary as strict JSON.

Voice: calm, factual, never scolding. "Your behavior is data, not a verdict."
- Use only the numbers you were explicitly given (focus minutes, prayer count, check-in scores). Never invent statistics.
- The life-area names you receive are the dimensions of life to comment on — they currently carry no score, because Mizan does not yet compute one. Speak to each area from the day's actual activity (tasks done in that category, prayer rhythm, check-in), not from a missing number.
- Headline (2-6 words): the single truest thing about today's pattern.
- Stat (1 sentence): the supporting number or contrast, plainly stated.
- Risk (1-2 sentences): the most useful warning, grounded in the data.
- lifeMap: one short insight per area, derived from today's actual activity in that category. Plain prose, no markdown, max ~22 words. Be specific to the area — do not template.

If the input is essentially empty (no completed tasks, no check-ins recorded), set headline to "Not enough data yet", explain in stat that he should check in for a few days first, leave risk empty, and produce minimal lifeMap entries saying "Needs more days of check-ins to read."`;

const insightsSchema = {
  type: "object",
  properties: {
    headline: { type: "string" },
    stat: { type: "string" },
    risk: { type: "string" },
    lifeMap: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          insight: { type: "string" },
        },
        required: ["name", "insight"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "stat", "risk", "lifeMap"],
  additionalProperties: false,
} as const;

function describeContext(context: CoachContext): string {
  const tasksDone = context.tasks.filter((t) => t.done);
  const tasksPending = context.tasks.filter((t) => !t.done);
  const focusMinutes = tasksDone.reduce((sum, t) => sum + t.minutes, 0);
  const prayerDone = context.prayers.filter((p) => p.done).length;
  // Phase 7: lifeAreas no longer carry score/delta/rank — those will be
  // derived from real history in a future pass. For now we just list the
  // area names so the model knows which dimensions of life to comment on.
  const areas = context.lifeAreas.map((a) => a.name).join(", ");
  const doneList = tasksDone.length
    ? tasksDone.map((t) => `"${t.title}" (${t.category}, ${t.minutes}m)`).join(", ")
    : "(none yet)";
  const pendingList = tasksPending.length
    ? tasksPending.map((t) => `"${t.title}" (${t.category})`).join(", ")
    : "(none)";

  return [
    `Day mode: ${context.mode}`,
    `Tasks done: ${doneList}`,
    `Tasks pending/rolled: ${pendingList}`,
    `Focus minutes today: ${focusMinutes} / 240 target`,
    `Prayers done: ${prayerDone} / 5`,
    `Quran done: ${context.quranDone ? "yes" : "no"}`,
    `Check-in: energy ${context.checkIn.energy}/5, pain ${context.checkIn.pain}/5, focus ${context.checkIn.focus}/5`,
    `Life areas: ${areas}`,
  ].join("\n");
}

function isEmpty(context: CoachContext): boolean {
  const noTasksDone = !context.tasks.some((t) => t.done);
  const defaultCheckIn =
    context.checkIn.energy === 3 && context.checkIn.pain === 2 && context.checkIn.focus === 3;
  return noTasksDone && defaultCheckIn;
}

const DEFAULT_AREA_NAMES = ["Faith", "Health", "Business", "College", "Mind", "Family", "Personality"];

function emptyStateResponse(context: CoachContext): InsightsResponse {
  // Use the areas the client actually sent, falling back to the canonical
  // list only when the client sent none — that way the empty-state UI shows
  // the same cards the user will see once data accumulates.
  const names = context.lifeAreas.length
    ? context.lifeAreas.map((a) => a.name)
    : DEFAULT_AREA_NAMES;
  return {
    headline: "Not enough data yet",
    stat: "Check in for a few days and complete real tasks — Mizan will start reading your patterns from there.",
    risk: "",
    lifeMap: names.map((name) => ({
      name,
      insight: "Needs more days of check-ins to read.",
    })),
    emptyState: true,
  };
}

export async function POST(request: Request): Promise<Response> {
  let payload: InsightsRequest;
  try {
    payload = (await request.json()) as InsightsRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload?.context) {
    return Response.json({ error: "context is required" }, { status: 400 });
  }

  if (isEmpty(payload.context)) {
    return Response.json(emptyStateResponse(payload.context) satisfies InsightsResponse);
  }

  const env = (process.env as { OPENROUTER_API_KEY?: string }) ?? {};
  const result = await completeJson<{
    headline: string;
    stat: string;
    risk: string;
    lifeMap: Array<{ name: string; insight: string }>;
  }>(env, {
    endpoint: "insights",
    maxTokens: 700,
    temperature: 0.5,
    jsonSchema: { name: "mizan_insights", schema: insightsSchema as unknown as Record<string, unknown> },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: describeContext(payload.context) },
    ],
  });

  if (!result.ok) {
    return Response.json(
      {
        headline: "Patterns forming",
        stat: "Mizan couldn't reach the analysis engine this time. Your day is still tracked; insights will refresh on the next call.",
        risk: "",
        // Phase 7: no fabricated per-area numbers in the fallback. The card
        // already shows an honest "—" for the score; the insight line says
        // plainly that the engine is offline.
        lifeMap: payload.context.lifeAreas.map((a) => ({
          name: a.name,
          insight: "Insight engine offline — refresh later.",
        })),
        fallback: true,
        error: result.error,
      } satisfies InsightsResponse,
      { status: 200 },
    );
  }

  // Map model output onto the same areas we were given, preserving order.
  const byName = new Map(result.value.lifeMap.map((entry) => [entry.name.toLowerCase(), entry.insight]));
  const lifeMap = payload.context.lifeAreas.map((area) => ({
    name: area.name,
    insight: (byName.get(area.name.toLowerCase()) ?? "Needs more days of check-ins to read.").slice(0, 240),
  }));

  return Response.json({
    headline: String(result.value.headline || "Today").slice(0, 90),
    stat: String(result.value.stat || "").slice(0, 320),
    risk: String(result.value.risk || "").slice(0, 360),
    lifeMap,
  } satisfies InsightsResponse);
}
