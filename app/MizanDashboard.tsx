"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type View = "today" | "goals" | "insights" | "coach" | "life" | "history";
type DayMode = "grinding" | "recovery" | "vacation";
type Category =
  | "Business"
  | "Health"
  | "Faith"
  | "College"
  | "Mind"
  | "Personality";

type Task = {
  id: number;
  title: string;
  category: Category;
  range: string;
  minutes: number;
  done: boolean;
  rolled: number;
  kind: "mission" | "support";
  details?: string;
  linkedGoalIds?: string[];
};

type Prayer = {
  name: string;
  time: string;
  done: boolean;
};

type DraftTask = Pick<Task, "title" | "category" | "range" | "minutes" | "kind" | "details" | "linkedGoalIds">;

const STORAGE_KEY = "mizan-life-os-v2";
// Phase 6: schema version. Stored alongside the payload so future migrations
// can detect the writer's version and upgrade in place. Bump on any breaking
// change to the shape of `PersistedState`. Anything older than the current
// version goes through `migratePayload` before being applied.
const SCHEMA_VERSION = 3;

// Phase 6: shape validation for the localStorage payload. We never trust
// arbitrary JSON on disk — every field is checked before it reaches React
// state. Failure is non-fatal: we surface a quiet notice and start fresh.
type PersistedPayload = {
  schemaVersion?: number;
  dateKey?: string;
  mode?: DayMode;
  tasks?: unknown;
  tomorrowTasks?: unknown;
  prayers?: unknown;
  checkIn?: unknown;
  challenge?: string;
  challengeDone?: boolean;
  quranDone?: boolean;
  highestTierDone?: number;
  contextNotes?: unknown;
  pastTasks?: unknown;
};

export type Goal = { id: string; title: string; tasksDone: number; parentGoalIds?: string[] };
export type Horizon = {
  label: string;
  startDate?: string;
  targetDate?: string;
  progress?: number;
  goals: Goal[];
};

function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const task = value as Record<string, unknown>;
  return (
    typeof task.title === "string" &&
    typeof task.category === "string" &&
    typeof task.range === "string" &&
    typeof task.minutes === "number" &&
    (task.kind === "mission" || task.kind === "support") &&
    typeof task.done === "boolean" &&
    typeof task.rolled === "number" &&
    (typeof task.id === "number" || typeof task.id === "string") &&
    (task.details === undefined || typeof task.details === "string") &&
    (task.linkedGoalIds === undefined || (Array.isArray(task.linkedGoalIds) && task.linkedGoalIds.every(id => typeof id === "string")))
  );
}

function isTaskList(value: unknown): value is Task[] {
  return Array.isArray(value) && value.every(isTask);
}

function isCheckIn(value: unknown): value is { energy: number; pain: number; focus: number } {
  if (typeof value !== "object" || value === null) return false;
  const check = value as Record<string, unknown>;
  return (
    typeof check.energy === "number" &&
    typeof check.pain === "number" &&
    typeof check.focus === "number"
  );
}

function isPrayerList(value: unknown): value is Prayer[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const prayer = item as Record<string, unknown>;
    return (
      typeof prayer.name === "string" &&
      typeof prayer.time === "string" &&
      typeof prayer.done === "boolean"
    );
  });
}

function validatePayload(parsed: unknown): { ok: true; value: PersistedPayload } | { ok: false } {
  if (typeof parsed !== "object" || parsed === null) return { ok: false };
  const p = parsed as PersistedPayload;
  // Coerce arrays we don't recognise back to empty so the day still loads.
  if (p.tasks !== undefined && !isTaskList(p.tasks)) return { ok: false };
  if (p.tomorrowTasks !== undefined && !isTaskList(p.tomorrowTasks)) return { ok: false };
  if (p.prayers !== undefined && !isPrayerList(p.prayers)) return { ok: false };
  if (p.checkIn !== undefined && !isCheckIn(p.checkIn)) return { ok: false };
  if (p.contextNotes !== undefined && !(Array.isArray(p.contextNotes) && p.contextNotes.every(n => typeof n === "string"))) return { ok: false };
  if (p.highestTierDone !== undefined && typeof p.highestTierDone !== "number") return { ok: false };
  if (p.challengeDone !== undefined && typeof p.challengeDone !== "boolean") return { ok: false };
  if (p.quranDone !== undefined && typeof p.quranDone !== "boolean") return { ok: false };
  if (p.pastTasks !== undefined && !Array.isArray(p.pastTasks)) return { ok: false };
  return { ok: true, value: p };
}

// Phase 6: forward-only migration.
function migratePayload(payload: PersistedPayload): PersistedPayload {
  let current = payload;
  if (!current.schemaVersion || current.schemaVersion < 2) {
    current = { ...current, contextNotes: undefined, schemaVersion: 2 };
  }
  if (current.schemaVersion === 2) {
    current = { ...current, pastTasks: [], schemaVersion: 3 };
  }
  return current;
}

const initialTasks: Task[] = [
  // Phase 7: empty by design. The previous seed (HustleIQ beta test, UGC
  // launch story, rehab, Japanese listening) posed as today's real work
  // without the user ever planning it. The dashboard now starts blank and
  // fills only with tasks the user actually approves through the planner.
];

function cairoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function cairoDateKey(date = new Date()) {
  const { year, month, day } = cairoDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cairoUtcOffset(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const cairoAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return (cairoAsUtc - date.getTime()) / 3_600_000;
}

function cairoDateAddDays(date: Date, days: number) {
  const { year, month, day } = cairoDateParts(date);
  const target = new Date(Date.UTC(year, month - 1, day + days));
  return target.toISOString().split("T")[0];
}

function minutesToClock(totalMinutes: number) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const hour12 = hour24 % 12 || 12;
  // Audit Phase 3: prayer times printed as "1:02" read as 1 AM to a user
  // skimming the panel. Append am/pm so Dhuhr at 13:02 reads "1:02 pm".
  const period = hour24 < 12 ? "am" : "pm";
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

// Phase 5: build a valid ISO time string (HH:MM) for the prayer <time>
// element so screen readers and assistive tech get an unambiguous value.
function prayerTimeIso(clock: string) {
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(clock.trim());
  if (!match) return clock;
  let hour = parseInt(match[1], 10);
  const minute = match[2];
  const period = match[3].toLowerCase();
  if (period === "pm" && hour !== 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function getCairoPrayerTimes(date = new Date()): Prayer[] {
  const { year, month, day } = cairoDateParts(date);
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12));
  const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86_400_000);
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
  const equationOfTime = 229.18 * (
    0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  );
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const latitude = 30.0444 * Math.PI / 180;
  const longitude = 31.2357;
  const solarNoon = 720 - 4 * longitude - equationOfTime + cairoUtcOffset(noonUtc) * 60;

  const hourAngleForZenith = (zenithDegrees: number) => {
    const zenith = zenithDegrees * Math.PI / 180;
    const cosine = (Math.cos(zenith) - Math.sin(latitude) * Math.sin(declination))
      / (Math.cos(latitude) * Math.cos(declination));
    return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  };
  const asrAltitude = Math.atan(1 / (1 + Math.tan(Math.abs(latitude - declination))));
  const asrCosine = (Math.sin(asrAltitude) - Math.sin(latitude) * Math.sin(declination))
    / (Math.cos(latitude) * Math.cos(declination));
  const asrHourAngle = Math.acos(Math.max(-1, Math.min(1, asrCosine))) * 180 / Math.PI;

  return [
    { name: "Fajr", time: minutesToClock(solarNoon - hourAngleForZenith(109.5) * 4), done: false },
    { name: "Dhuhr", time: minutesToClock(solarNoon + 1), done: false },
    { name: "Asr", time: minutesToClock(solarNoon + asrHourAngle * 4), done: false },
    { name: "Maghrib", time: minutesToClock(solarNoon + hourAngleForZenith(90.833) * 4 + 2), done: false },
    { name: "Isha", time: minutesToClock(solarNoon + hourAngleForZenith(107.5) * 4), done: false },
  ];
}

const navItems: { id: View; label: string; icon: IconName }[] = [
  { id: "today", label: "Today", icon: "sun" },
  { id: "goals", label: "Goals", icon: "target" },
  { id: "insights", label: "Insights", icon: "chart" },
  { id: "coach", label: "Coach", icon: "spark" },
  { id: "life", label: "Life map", icon: "map" },
];

// Phase 7: lifeAreas keep their structural identity (name + color) but no
// longer carry fake scores, deltas, or ranks. The Today view and Life map
// render an honest "not enough data yet" state instead of pretending to
// have measured the user. Scores reappear only when a real signal source
// (task completion history, prayer consistency, etc.) is wired in.
const lifeAreas = [
  { name: "Faith", color: "faith" },
  { name: "Health", color: "health" },
  { name: "Business", color: "business" },
  { name: "College", color: "college" },
  { name: "Mind", color: "mind" },
  { name: "Family", color: "family" },
  { name: "Personality", color: "personality" },
];

const personalityChallenges: Array<{ text: string; tier: 0 | 1 | 2 }> = [
  { text: "Speak to one new person and ask a real follow-up question", tier: 0 },
  { text: "Start a conversation at physiotherapy or college", tier: 0 },
  { text: "Record a 10-minute explanation with fewer than five filler words", tier: 1 },
  { text: "Pitch HustleIQ in 60 seconds without reading a script", tier: 1 },
  { text: "Ask one founder for direct feedback on your beta-testing problem", tier: 1 },
  { text: "Make one cold call and stay present through the discomfort", tier: 2 },
];

// Phase 7: weeklyBars is empty until real per-day completion history is
// tracked. The Insights chart renders an explicit empty state when this is
// empty rather than drawing fabricated bars.
const weeklyBars: number[] = [];

const getInitialGoals = () => {
  const now = new Date();
  return [
    {
      label: "Next 30 days",
      progress: 42,
      startDate: cairoDateAddDays(now, -12),
      targetDate: cairoDateAddDays(now, 18),
      goals: [
        { id: crypto.randomUUID(), title: "Publish HustleIQ on web and app stores", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Recruit real beta testers and validate the core idea", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Improve physical and mental health", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Begin agency outreach", tasksDone: 0 },
      ],
    },
    {
      label: "Next 3 months",
      progress: 28,
      startDate: cairoDateAddDays(now, -25),
      targetDate: cairoDateAddDays(now, 65),
      goals: [
        { id: crypto.randomUUID(), title: "Earn the first $200/month", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Raise stamina and health above average", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Build a repeatable outreach rhythm", tasksDone: 0 },
      ],
    },
    {
      label: "One year",
      progress: 14,
      startDate: cairoDateAddDays(now, -51),
      targetDate: cairoDateAddDays(now, 314),
      goals: [
        { id: crypto.randomUUID(), title: "Reach $1,000/month", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Do not miss prayer and grow closer to God", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Become above average at sales, networking and public speaking", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Pass exams with health and relationships intact", tasksDone: 0 },
      ],
    },
    {
      label: "Five years",
      progress: 5,
      startDate: cairoDateAddDays(now, -91),
      targetDate: cairoDateAddDays(now, 1734),
      goals: [
        { id: crypto.randomUUID(), title: "Earn $10k–$20k/month", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Develop top-tier sales and networking skills", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Build a strong, healthy 90kg body and finish a 5km race", tasksDone: 0 },
        { id: crypto.randomUUID(), title: "Grow YouTube, learn seven languages and sharpen fighting skills", tasksDone: 0 },
      ],
    },
  ];
};

type IconName =
  | "sun"
  | "target"
  | "chart"
  | "spark"
  | "map"
  | "clock"
  | "flame"
  | "check"
  | "mic"
  | "arrow"
  | "plus"
  | "moon"
  | "brain"
  | "heart"
  | "briefcase"
  | "book"
  | "users"
  | "menu"
  | "close"
  | "send"
  | "pause";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  const paths: Record<IconName, React.ReactNode> = {
    sun: <><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/></>,
    target: <><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    spark: <><path d="m12 3 1.3 4.4a4.7 4.7 0 0 0 3.2 3.2L21 12l-4.5 1.4a4.7 4.7 0 0 0-3.2 3.2L12 21l-1.3-4.4a4.7 4.7 0 0 0-3.2-3.2L3 12l4.5-1.4a4.7 4.7 0 0 0 3.2-3.2L12 3Z"/></>,
    map: <><path d="m3 6 5-3 8 3 5-3v15l-5 3-8-3-5 3V6Z"/><path d="M8 3v15M16 6v15"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    flame: <path d="M13.5 3S15 7 11 9c-2.4 1.2-3.6 3.4-2.2 5.7.5-2.1 1.9-3.1 3.2-3.7-.3 2.5 1.5 3.5 2.2 5.2.7-1 1.2-2.1 1.2-3.2 1.7 1.3 2.6 3.2 2.2 5.2A7 7 0 0 1 5 15c0-5.7 5.7-6.2 8.5-12Z"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    moon: <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z"/>,
    brain: <><path d="M9.5 4.5A3 3 0 0 0 4.8 7a3.5 3.5 0 0 0-.3 6.7A3.4 3.4 0 0 0 9.5 18V4.5ZM14.5 4.5A3 3 0 0 1 19.2 7a3.5 3.5 0 0 1 .3 6.7 3.4 3.4 0 0 1-5 4.3V4.5Z"/><path d="M9.5 9H7.8M14.5 9h1.7M9.5 14H7.8M14.5 14h1.7"/></>,
    heart: <path d="M20.8 5.8a5 5 0 0 0-7.1 0L12 7.5l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21l8.8-8.1a5 5 0 0 0 0-7.1Z"/>,
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/></>,
    book: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 4.5a3 3 0 0 1 0 6M17 14.5a5.5 5.5 0 0 1 3.5 5.5"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></>,
    pause: <><path d="M9 5v14M15 5v14"/></>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function classifyTask(title: string): Category {
  if (/prayer|quran|fajr|dhuhr|asr|maghrib|isha/i.test(title)) return "Faith";
  if (/rehab|health|run|sleep|physio|adductor|steps/i.test(title)) return "Health";
  if (/study|college|exam|assignment|lecture/i.test(title)) return "College";
  if (/speak|call|camera|pitch|social|network/i.test(title)) return "Personality";
  if (/japanese|learn|read|meditat|research/i.test(title)) return "Mind";
  return "Business";
}

function microStepFor(task: Task) {
  if (task.category === "Business") return `Open the one file or page needed for “${task.title}”. Work for five minutes only.`;
  if (task.category === "Health") return "Put on your rehabilitation clothes, prepare water, and complete the first prescribed movement.";
  if (task.category === "Mind") return "Set a two-minute timer and begin with the smallest lesson. Momentum can decide the rest.";
  if (task.category === "Personality") return "Stand up, breathe once, and record the first 60 seconds. Do not restart.";
  return `Take the first visible action for “${task.title}” for five minutes.`;
}

export function MizanDashboard() {
  const [view, setView] = useState<View>("today");
  const [mode, setMode] = useState<DayMode>("grinding");
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [pastTasks, setPastTasks] = useState<{ dateKey: string; tasks: Task[] }[]>([]);
  const [tomorrowTasks, setTomorrowTasks] = useState<Task[]>([]);
  const [prayers, setPrayers] = useState<Prayer[]>(() => getCairoPrayerTimes());
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [brainDump, setBrainDump] = useState("");
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([]);
  const [stuckMessage, setStuckMessage] = useState("");
  const [stuckPending, setStuckPending] = useState(false);
  // When the stuck endpoint is unreachable, we fall back to the local
  // microStepFor heuristic — but mark it so the chip says so. Per the
  // audit fix: never silently serve a local heuristic as if it were AI.
  const [stuckFallback, setStuckFallback] = useState(false);
  const [challenge, setChallenge] = useState<string>(personalityChallenges[1].text);
  const [challengeDone, setChallengeDone] = useState(false);
  const [writingChallenge, setWritingChallenge] = useState(false);
  const [draftChallenge, setDraftChallenge] = useState("");
  const [offlinePlannerMode, setOfflinePlannerMode] = useState(false);
  // Personality-grind escalation: highest tier the user has actually completed
  // (0 = entry, 1 = medium, 2 = hard). drawChallenge biases the next pick
  // toward tier+1 so the user does not stall at the same difficulty.
  const [highestTierDone, setHighestTierDone] = useState(0);
  const [quranDone, setQuranDone] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | "new" | null>(null);
  const [newTaskKind, setNewTaskKind] = useState<"mission" | "support">("mission");
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [checkIn, setCheckIn] = useState({ energy: 3, pain: 2, focus: 3 });
  const [toast, setToast] = useState("");
  const [coachInput, setCoachInput] = useState("");
  const [coachMessages, setCoachMessages] = useState([
    {
      from: "coach" as const,
      text: "Assalamu alaykum. Your health is improving, but uncertainty is stealing more energy than the work itself. What is on your mind?",
    },
  ]);
  const [contextNotes, setContextNotes] = useState<string[]>(["Tap to describe what you're balancing right now."]);
  const [goalHorizonsState, setGoalHorizonsState] = useState<Horizon[]>([]);
  const [editingTomorrowId, setEditingTomorrowId] = useState<number | null>(null);
  const [editingDraftIndex, setEditingDraftIndex] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // AI request state — visible failure modes per Phase 1 spec.
  // `pending` controls inline spinner; `error` is a user-facing string shown
  // when a call fails; `fallback` is set when the rule-based fallback fired.
  const [coachPending, setCoachPending] = useState(false);
  const [coachError, setCoachError] = useState("");
  const [arrangePending, setArrangePending] = useState(false);
  const [arrangeError, setArrangeError] = useState("");
  const [arrangeFallback, setArrangeFallback] = useState(false);
  const [arrangeReasoning, setArrangeReasoning] = useState("");
  const [insights, setInsights] = useState<{
    headline: string;
    stat: string;
    risk: string;
    lifeMap: Array<{ name: string; insight: string }>;
    emptyState?: boolean;
    fallback?: boolean;
  } | null>(null);
  const [insightsPending, setInsightsPending] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  // Voice state. `isListening` toggles true while the mic is recording.
  // `voicePhase` distinguishes download / transcribe / error so the
  // voice button can render distinct copy for each.
  const [isListening, setIsListening] = useState(false);
  const [voicePhase, setVoicePhase] = useState<"idle" | "recording" | "downloading" | "transcribing" | "error">("idle");
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [voiceError, setVoiceError] = useState("");
  // Mutable abort handle. We don't need a full AbortController —
  // the whisper module polls `aborted` and stops MediaRecorder tracks.
  const voiceAbortRef = useRef<{ aborted: boolean } | null>(null);
  // Phase 3: rollover reconsideration. When a task hits rolled===4 we surface
  // a modal instead of silently auto-rolling it forever. The user decides:
  // keep (reset counter), drop (delete), or defer (dismiss, counter stays).
  const [rolloverReviewOpen, setRolloverReviewOpen] = useState(false);
  // Phase 6: surfaced when localStorage payload fails shape validation. Kept
  // as a separate, non-alarming notice rather than the existing toast so the
  // message can persist beyond the 3.2s toast window and stays visually quiet.
  const [dataNotice, setDataNotice] = useState("");
  // Phase 4: Rollover detection clock
  const [cairoNow, setCairoNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setCairoNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const todayKey = cairoDateKey(cairoNow);
  const weekdayLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "Africa/Cairo" }).format(cairoNow);
  const dateLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "Africa/Cairo" }).format(cairoNow);
  const [loadedDay, setLoadedDay] = useState(todayKey);

  function getInitialGoals(): Horizon[] {
    const { year } = cairoDateParts(cairoNow);
    const endOfYear = `${year}-12-31`;
    const plus30 = cairoDateAddDays(cairoNow, 30);
    const plus90 = cairoDateAddDays(cairoNow, 90);
    
    const today = cairoDateKey(cairoNow);
    return [
      { id: "1mo", label: "Next 30 days", progress: 0, goals: [], startDate: today, targetDate: plus30 },
      { id: "3mo", label: "Next 3 months", progress: 0, goals: [], startDate: today, targetDate: plus90 },
      { id: "1yr", label: "One year", progress: 0, goals: [], startDate: today, targetDate: endOfYear },
      { id: "5yr", label: "Five years", progress: 0, goals: [], startDate: today, targetDate: "" }
    ];
  }

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const raw = JSON.parse(saved);
          const validation = validatePayload(raw);
          if (!validation.ok) {
            // Phase 6: validation failed. Drop the payload, surface a quiet
            // notice, and let the rest of the day render from defaults.
            // We never claim the data was "corrupted" or "broken" — the copy
            // is intentionally calm so the user doesn't panic.
            window.localStorage.removeItem(STORAGE_KEY);
            setDataNotice("Mizan could not read your saved workspace, so it started fresh. Your day continues as normal.");
            setHydrated(true);
            return;
          }
          const parsed = migratePayload(validation.value);
          const isSameCairoDay = parsed.dateKey === todayKey;
          if (isSameCairoDay) {
            if (parsed.mode) setMode(parsed.mode);
            if (parsed.tasks && Array.isArray(parsed.tasks)) {
              parsed.tasks = parsed.tasks.map((t: any) => {
                if (t.linkedGoalId && !t.linkedGoalIds) {
                  return { ...t, linkedGoalIds: [t.linkedGoalId] };
                }
                return t;
              });
              setTasks(parsed.tasks as Task[]);
            }
            if (parsed.tomorrowTasks && Array.isArray(parsed.tomorrowTasks)) {
              parsed.tomorrowTasks = parsed.tomorrowTasks.map((t: any) => {
                if (t.linkedGoalId && !t.linkedGoalIds) {
                  return { ...t, linkedGoalIds: [t.linkedGoalId] };
                }
                return t;
              });
              setTomorrowTasks(parsed.tomorrowTasks as Task[]);
            }
            if (parsed.prayers) setPrayers(parsed.prayers);
            if (parsed.checkIn) setCheckIn(parsed.checkIn);
            if (parsed.challenge) setChallenge(parsed.challenge);
            if (typeof parsed.challengeDone === "boolean") setChallengeDone(parsed.challengeDone);
            if (typeof parsed.quranDone === "boolean") setQuranDone(parsed.quranDone);
            if (typeof parsed.highestTierDone === "number") setHighestTierDone(parsed.highestTierDone);
            if (parsed.pastTasks) {
              setPastTasks(parsed.pastTasks as { dateKey: string; tasks: Task[] }[]);
            }
          } else {
            // Rollover logic: we are on a new day. Save yesterday's tasks into history.
            let newPastTasks = (parsed.pastTasks as { dateKey: string; tasks: Task[] }[]) || [];
            if (parsed.tasks && Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
              newPastTasks = [{ dateKey: parsed.dateKey || "unknown", tasks: parsed.tasks as Task[] }, ...newPastTasks];
              // Keep only last 30 days
              if (newPastTasks.length > 30) newPastTasks = newPastTasks.slice(0, 30);
            }
            setPastTasks(newPastTasks);

            if (parsed.tomorrowTasks?.length) {
              setTasks(parsed.tomorrowTasks.map((task) => ({ ...task, done: false })));
            } else if (parsed.tasks?.length) {
              const rolled = parsed.tasks
                .filter((task) => !task.done)
                .map((task) => ({ ...task, done: false, rolled: Math.min(4, task.rolled + 1) }));
              if (rolled.length) setTasks(rolled);
            }
          }
          // contextNotes persist across days
          if (parsed.contextNotes) setContextNotes(parsed.contextNotes as string[]);
        }
      } catch {
        // Phase 6: JSON.parse threw — same calm notice path as a failed
        // shape check. Don't swallow silently, don't alarm the user.
        setDataNotice("Mizan could not read your saved workspace, so it started fresh. Your day continues as normal.");
        window.localStorage.removeItem(STORAGE_KEY);
      }
      
      try {
        const savedGoalsV2 = window.localStorage.getItem("mizan-goals-v2");
        if (savedGoalsV2) {
          const parsedV2 = JSON.parse(savedGoalsV2);
          const repaired = parsedV2.map((h: any) => {
            let startDate = h.startDate;
            let targetDate = h.targetDate;
            if (!targetDate) {
              const now = new Date();
              if (h.label === "Next 30 days") { startDate = cairoDateAddDays(now, -12); targetDate = cairoDateAddDays(now, 18); }
              else if (h.label === "Next 3 months") { startDate = cairoDateAddDays(now, -25); targetDate = cairoDateAddDays(now, 65); }
              else if (h.label === "One year") { startDate = cairoDateAddDays(now, -51); targetDate = cairoDateAddDays(now, 314); }
              else if (h.label === "Five years") { startDate = cairoDateAddDays(now, -91); targetDate = cairoDateAddDays(now, 1734); }
              else { startDate = startDate || cairoDateKey(now); }
            }
            return {
              ...h,
              startDate,
              targetDate,
              goals: h.goals.map((g: any) => {
                if (typeof g === "string") return { id: crypto.randomUUID(), title: g, tasksDone: 0 };
                let migratedParentIds = g.parentGoalIds;
                if (!migratedParentIds && g.parentGoalId) {
                  migratedParentIds = [g.parentGoalId];
                }
                return { id: g.id || crypto.randomUUID(), title: g.title, tasksDone: g.tasksDone || 0, parentGoalIds: migratedParentIds };
              })
            };
          });
          setGoalHorizonsState(repaired);
        } else {
          const savedGoalsV1 = window.localStorage.getItem("mizan-goals-v1");
          if (savedGoalsV1) {
            const parsedV1 = JSON.parse(savedGoalsV1) as { label: string; targetDate?: string; progress: number; goals: string[] }[];
            setGoalHorizonsState(parsedV1.map((h: any) => {
              let startDate = cairoDateKey(new Date());
              let targetDate = h.targetDate;
              if (!targetDate) {
                const now = new Date();
                if (h.label === "Next 30 days") { startDate = cairoDateAddDays(now, -12); targetDate = cairoDateAddDays(now, 18); }
                else if (h.label === "Next 3 months") { startDate = cairoDateAddDays(now, -25); targetDate = cairoDateAddDays(now, 65); }
                else if (h.label === "One year") { startDate = cairoDateAddDays(now, -51); targetDate = cairoDateAddDays(now, 314); }
                else if (h.label === "Five years") { startDate = cairoDateAddDays(now, -91); targetDate = cairoDateAddDays(now, 1734); }
              }
              return {
                ...h,
                startDate,
                targetDate,
                goals: h.goals.map((g: any) => ({ id: crypto.randomUUID(), title: g, tasksDone: 0 }))
              };
            }));
          } else {
            setGoalHorizonsState(getInitialGoals());
          }
        }
      } catch {
        setGoalHorizonsState(getInitialGoals());
      }
      
      // Phase 3: Hydrate drafts
      try {
        const dPlanner = window.localStorage.getItem("mizan-draft-planner");
        if (dPlanner) setBrainDump(dPlanner);
        const dCoach = window.localStorage.getItem("mizan-draft-coach");
        if (dCoach) setCoachInput(dCoach);
      } catch {
        // ignore
      }

      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(loadTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        dateKey: todayKey,
        mode,
        tasks,
        tomorrowTasks,
        prayers,
        checkIn,
        challenge,
        challengeDone,
        quranDone,
        highestTierDone,
        contextNotes,
        pastTasks,
      }),
    );
  }, [hydrated, todayKey, mode, tasks, tomorrowTasks, prayers, checkIn, challenge, challengeDone, quranDone, highestTierDone, contextNotes, pastTasks]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem("mizan-goals-v2", JSON.stringify(goalHorizonsState));
  }, [hydrated, goalHorizonsState]);

  // Phase 3: when hydration reveals any task that has hit the 4-roll cap,
  // open the reconsideration modal once. We do not auto-delete or auto-reset
  // — the user must choose what to do with each one. The guard on
  // `rolloverReviewOpen` prevents the modal from re-opening after the user
  // dismisses it, even if the underlying task is still at rolled===4.
  useEffect(() => {
    if (!hydrated) return;
    if (rolloverReviewOpen) return;
    const stuck = tasks.some((task) => !task.done && task.rolled >= 4);
    if (stuck) window.setTimeout(() => setRolloverReviewOpen(true), 0);
  }, [hydrated, tasks, rolloverReviewOpen]);

  // Phase 3: Draft persistence (debounced)
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      if (brainDump.trim()) {
        window.localStorage.setItem("mizan-draft-planner", brainDump);
      } else {
        window.localStorage.removeItem("mizan-draft-planner");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [hydrated, brainDump]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      if (coachInput.trim()) {
        window.localStorage.setItem("mizan-draft-coach", coachInput);
      } else {
        window.localStorage.removeItem("mizan-draft-coach");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [hydrated, coachInput]);

  // Phase 4: Midnight rollover for tabs left open across the day boundary
  useEffect(() => {
    if (!hydrated) return;
    if (todayKey !== loadedDay) {
      window.setTimeout(() => {
        setLoadedDay(todayKey);
        setTasks((current) => {
          const rolled = current
            .filter((t) => !t.done)
            .map((t) => ({ ...t, done: false, rolled: Math.min(4, t.rolled + 1) }));
          if (tomorrowTasks.length) {
            return tomorrowTasks.map((t) => ({ ...t, done: false }));
          }
          return rolled.length ? rolled : current;
        });
        setTomorrowTasks([]);
        setCheckIn({ energy: 3, pain: 2, focus: 3 });
        setPrayers(getCairoPrayerTimes(cairoNow));
        setChallengeDone(false);
        setQuranDone(false);
        // contextNotes and highestTierDone persist across days
      }, 0);
    }
  }, [hydrated, todayKey, loadedDay, tomorrowTasks, cairoNow]);

  function resetRollover(id: number) {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, rolled: 0 } : task)));
  }

  function dropTask(id: number) {
    setTasks((current) => current.filter((task) => task.id !== id));
  }

  function updateTask(id: number, patch: Partial<Task>) {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)));
    setEditingTaskId(null);
  }

  function updateTomorrowTask(id: number, patch: Partial<Task>) {
    setTomorrowTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)));
    setEditingTomorrowId(null);
  }

  function updateDraftTask(index: number, patch: Partial<DraftTask>) {
    setDraftTasks((current) => current.map((task, i) => (i === index ? { ...task, ...patch } : task)));
    setEditingDraftIndex(null);
  }

  function updateHorizon(index: number, patch: Partial<Horizon>) {
    setGoalHorizonsState((current) => current.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  }

  function addGoalToHorizon(index: number, goal: Goal) {
    if (!goal.title.trim()) return;
    setGoalHorizonsState((current) =>
      current.map((h, i) => (i === index ? { ...h, goals: [...h.goals, goal] } : h))
    );
  }

  function removeGoalFromHorizon(horizonIndex: number, goalIndex: number) {
    setGoalHorizonsState((current) =>
      current.map((h, i) =>
        i === horizonIndex ? { ...h, goals: h.goals.filter((_, gI) => gI !== goalIndex) } : h
      )
    );
  }

  function addContextNote(text: string) {
    if (!text.trim()) return;
    setContextNotes((current) => [...current, text.trim()]);
  }

  function updateContextNote(index: number, text: string) {
    if (!text.trim()) {
      removeContextNote(index);
      return;
    }
    setContextNotes((current) => current.map((n, i) => (i === index ? text.trim() : n)));
  }

  function removeContextNote(index: number) {
    setContextNotes((current) => current.filter((_, i) => i !== index));
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Insights run about once a day per the Phase 1 spec. Cache the result in
  // localStorage under a dateKey-scoped key so we don't pay for the same
  // commentary twice. The state itself is also stored in React state.
  const insightsCacheKey = `mizan-insights-${todayKey}`;
  useEffect(() => {
    if (!hydrated) return;
    if (insights) return; // already loaded this session
    try {
      const cached = window.localStorage.getItem(insightsCacheKey);
      if (cached) {
        window.setTimeout(() => setInsights(JSON.parse(cached)), 0);
        return;
      }
    } catch {
      // ignore malformed cache
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInsightsPending(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInsightsError("");
    fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: buildCoachContext() }),
    })
      .then((r) => r.json())
      .then((data: {
        headline?: string;
        stat?: string;
        risk?: string;
        lifeMap?: Array<{ name: string; insight: string }>;
        emptyState?: boolean;
        fallback?: boolean;
        error?: string;
      }) => {
        if (cancelled) return;
        if (!data.headline) {
          setInsightsError(data.error ?? "Insights unavailable right now.");
        } else {
          const next = {
            headline: data.headline,
            stat: data.stat ?? "",
            risk: data.risk ?? "",
            lifeMap: data.lifeMap ?? [],
            emptyState: data.emptyState,
            fallback: data.fallback,
          };
          setInsights(next);
          try {
            window.localStorage.setItem(insightsCacheKey, JSON.stringify(next));
          } catch {
            // ignore quota errors
          }
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setInsightsError(err instanceof Error ? err.message : "Insights unavailable right now.");
      })
      .finally(() => {
        if (!cancelled) setInsightsPending(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, todayKey, insightsCacheKey]);

  const focusMinutes = useMemo(
    () => tasks.filter((task) => task.done).reduce((sum, task) => sum + task.minutes, 0),
    [tasks],
  );
  const focusProgress = Math.min(100, Math.round((focusMinutes / 240) * 100));
  const prayerProgress = prayers.filter((prayer) => prayer.done).length;
  const dailyScore = Math.round(
    Math.min(100, focusProgress * 0.55 + (prayerProgress / 5) * 35 + (challengeDone ? 10 : 0)),
  );

  const visibleTasks = useMemo(() => {
    if (mode === "vacation") return [];
    if (mode === "recovery") {
      const health = tasks.filter((task) => task.category === "Health");
      const realWork = tasks.find((task) => task.kind === "mission");
      return realWork ? [...health, realWork].filter((task, index, all) => all.findIndex((item) => item.id === task.id) === index) : health;
    }
    return tasks;
  }, [mode, tasks]);
  const nextTask = visibleTasks.find((task) => !task.done);
  const completedTaskCount = visibleTasks.filter((task) => task.done).length;
  const remainingFocusMinutes = Math.max(0, 240 - focusMinutes);

  function toggleTask(id: number) {
    let linkedGoalIdsToUpdate: string[] = [];
    let willBeDone = false;

    setTasks((current) =>
      current.map((task) => {
        if (task.id === id) {
          linkedGoalIdsToUpdate = task.linkedGoalIds || [];
          willBeDone = !task.done;
          return { ...task, done: willBeDone };
        }
        return task;
      })
    );
    if (activeTaskId === id) setActiveTaskId(null);

    if (linkedGoalIdsToUpdate.length > 0) {
      setGoalHorizonsState((current) => {
        const parentMap: Record<string, string[]> = {};
        for (const horizon of current) {
          for (const goal of horizon.goals) {
            if (goal.parentGoalIds && goal.parentGoalIds.length > 0) {
              parentMap[goal.id] = goal.parentGoalIds;
            }
          }
        }

        const idsToUpdate = new Set<string>();
        const queue = [...linkedGoalIdsToUpdate];
        
        while (queue.length > 0) {
          const currentId = queue.shift()!;
          if (!idsToUpdate.has(currentId)) {
            idsToUpdate.add(currentId);
            const parents = parentMap[currentId];
            if (parents) {
              queue.push(...parents);
            }
          }
        }

        return current.map((horizon) => ({
          ...horizon,
          goals: horizon.goals.map((goal) => {
            if (idsToUpdate.has(goal.id)) {
              return { ...goal, tasksDone: Math.max(0, goal.tasksDone + (willBeDone ? 1 : -1)) };
            }
            return goal;
          }),
        }));
      });
    }
  }

  function startNextMission() {
    if (!nextTask) {
      setToast("Every mission is complete. Protect the win and close the day well.");
      return;
    }
    setActiveTaskId(nextTask.id);
    setToast(`Mission armed: ${nextTask.title}. Remove the phone and begin the first five minutes.`);
  }

  function togglePrayer(name: string) {
    setPrayers((current) =>
      current.map((prayer) =>
        prayer.name === name ? { ...prayer, done: !prayer.done } : prayer,
      ),
    );
  }

  function chooseMode(next: DayMode) {
    setMode(next);
    const copy =
      next === "grinding"
        ? "Grinding Day active. Four focused hours stay protected."
        : next === "recovery"
          ? "Recovery Day active. Rehabilitation, prayer, rest, and one real task."
          : "Vacation Day active. No work today. Recharge without guilt.";
    setToast(copy);
  }

  function buildCoachContext() {
    return {
      mode,
      tasks: tasks.map((t) => ({
        title: t.title,
        category: t.category,
        range: t.range,
        minutes: t.minutes,
        done: t.done,
        kind: t.kind,
        rolled: t.rolled,
      })),
      prayers: prayers.map((p) => ({ name: p.name, time: p.time, done: p.done })),
      quranDone,
      checkIn,
      challenge,
      challengeDone,
      // Phase 7: scores/deltas/ranks were removed from lifeAreas because they
      // were fabricated. We send only the structural names so the coach knows
      // which life areas the user is balancing, without lying about metrics.
      lifeAreas: lifeAreas.map((a) => ({ name: a.name })),
      contextNotes,
      dateKey: todayKey,
    };
  }

  async function arrangePlan() {
    setArrangeError("");
    setArrangeFallback(false);
    setArrangeReasoning("");
    setArrangePending(true);
    
    if (offlinePlannerMode) {
      applyOfflinePlan();
      setArrangePending(false);
      return;
    }
    
    try {
      const response = await fetch("/api/arrange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brainDump, context: buildCoachContext() }),
      });
      const data = (await response.json()) as {
        plan?: { tasks: DraftTask[]; overallReasoning?: string };
        fallback?: boolean;
        error?: string;
      };
      if (!response.ok || !data.plan) {
        throw new Error(data.error ?? `Arrange failed (${response.status})`);
      }
      setDraftTasks(data.plan.tasks);
      setArrangeReasoning(data.plan.overallReasoning ?? "");
      if (data.fallback) {
        setArrangeFallback(true);
        setArrangeError(data.error ?? "AI is unavailable right now.");
      }
    } catch (err) {
      applyOfflinePlan(err instanceof Error ? err.message : "AI is unavailable right now. Offline arrangement shown below.");
    } finally {
      setArrangePending(false);
    }
  }

  function applyOfflinePlan(errorMessage?: string) {
    const lines = brainDump.split(/\n|,/).map((line) => line.trim()).filter(Boolean).slice(0, 5);
    const source = lines.length ? lines : ["Find three real beta testers", "Record one clear UGC video", "Complete rehabilitation and reading"];
    const ranges = ["10:30 am – 1:00 pm", "4:30 pm – 6:00 pm", "8:30 pm – 10:00 pm", "2:00 pm – 3:00 pm", "6:30 pm – 7:15 pm"];
    setDraftTasks(
      source.map((title, index) => ({
        title,
        category: classifyTask(title),
        range: ranges[index] ?? "Flexible",
        minutes: index === 0 ? 150 : index === 1 ? 90 : 60,
        kind: index < 2 ? ("mission" as const) : ("support" as const),
      })),
    );
    setArrangeFallback(true);
    setArrangeError(errorMessage ?? "Arranged using offline algorithm.");
  }

  function approvePlan() {
    if (!draftTasks.length) return;
    setTomorrowTasks(
      draftTasks.map((task, index) => ({
        ...task,
        id: Date.now() + index,
        done: false,
        rolled: 0,
      })),
    );
    setDraftTasks([]);
    setBrainDump("");
    window.localStorage.removeItem("mizan-draft-planner");
    setArrangeReasoning("");
    setArrangeFallback(false);
    setArrangeError("");
    // Keep the planner open so the user can review or remove items from the
    // approved plan before the day flips. Closing immediately hid the result
    // of their work and gave no way to correct a wrong item without replanning
    // from scratch.
    setToast("Tomorrow is arranged. Review or remove items below.");
  }

  function removeTomorrowTask(id: number) {
    setTomorrowTasks((current) => current.filter((task) => task.id !== id));
  }

  function scrapTomorrowPlan() {
    // Reset back to draft mode so the user can re-arrange from their brain
    // dump. We do not clear brainDump — they may want to edit and retry.
    setTomorrowTasks([]);
    setToast("Tomorrow’s plan was cleared. Arrange again when you’re ready.");
  }

  async function helpMeStart() {
    // Phase 1 gap fix: route "I'm stuck" through /api/coach with mode:"stuck"
    // and a tight max_tokens budget (~60-100 out). The model returns ONE
    // concrete five-minute move addressing the specific task — not a
    // category-templated sentence. If the call fails, we fall back to the
    // local microStepFor heuristic AND label the chip "offline", so we
    // never serve a local heuristic as if it were AI.
    const target = visibleTasks.find((task) => !task.done);
    if (!target) {
      setStuckFallback(false);
      setStuckMessage("Your planned work is complete. Protect recovery and close the day well.");
      return;
    }
    setStuckPending(true);
    setStuckMessage("");
    setStuckFallback(false);
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "",
          mode: "stuck",
          context: buildCoachContext(),
        }),
      });
      const data = (await response.json()) as { reply?: string; error?: string };
      if (!response.ok || !data.reply) {
        throw new Error(data.error ?? `Coach stuck failed (${response.status})`);
      }
      setStuckMessage(data.reply.trim());
    } catch (err) {
      // Visible fallback: keep the planner usable offline, but say so.
      setStuckFallback(true);
      setStuckMessage(microStepFor(target));
      void err; // surfaced via stuckFallback label
    } finally {
      setStuckPending(false);
    }
  }

  function drawChallenge() {
    // Escalation rule (audit fix): the old drawChallenge picked uniformly from
    // the full array, so the user could stall on tier-0 reps forever. Now we
    // bias the next pick toward the next uncompleted tier. 70% chance we draw
    // from the target tier, 30% we draw from any tier (keeps variety).
    const currentTier = personalityChallenges.find((c) => c.text === challenge)?.tier ?? 0;
    const targetTier = Math.min(2, Math.max(currentTier, highestTierDone) + 1) as 0 | 1 | 2;

    const poolFromTier = (tier: 0 | 1 | 2) =>
      personalityChallenges.filter((c) => c.tier === tier && c.text !== challenge);

    const useTarget = Math.random() < 0.7;
    const candidatePool = useTarget && poolFromTier(targetTier).length
      ? poolFromTier(targetTier)
      : personalityChallenges.filter((c) => c.text !== challenge);

    const next = candidatePool[Math.floor(Math.random() * candidatePool.length)]
      ?? personalityChallenges.find((c) => c.text !== challenge)
      ?? personalityChallenges[0];
    setChallenge(next.text);
    setChallengeDone(false);
  }

  function markChallengeDone() {
    if (!challengeDone) {
      // Toggling from "not done" → "done": record tier progress.
      const tier = personalityChallenges.find((c) => c.text === challenge)?.tier ?? 0;
      if (tier > highestTierDone) setHighestTierDone(tier);
    }
    setChallengeDone((done) => !done);
  }

  // Local Whisper transcription via transformers.js. See app/_voice/whisper.ts
  // for the underlying pipeline. The flow is:
  //   1. First tap on voice button → check browser support, start recording,
  //      flip to "Listening… (tap to stop)".
  //   2. Second tap → stop recording, download model if first time, transcribe.
  //   3. Append transcript to either the planner brain-dump or coach input.
  //
  // Visible failure modes:
  //   - mic denied → button briefly reads "Mic blocked" with a toast.
  //   - unsupported browser → toast, button disabled for that target.
  //   - download fails / transcription fails → toast with the actual reason.
  async function startVoice(target: "planner" | "coach") {
    // Phase 5: Voice interruptability
    if (voicePhase === "downloading" || voicePhase === "transcribing") {
      if (voiceAbortRef.current) voiceAbortRef.current.aborted = true;
      setVoicePhase("idle");
      setVoiceProgress(0);
      setIsListening(false);
      setVoiceError("");
      return;
    }

    // Already recording → stop and transcribe.
    if (voiceAbortRef.current) {
      voiceAbortRef.current.aborted = true;
      return;
    }
    setVoiceError("");
    setVoicePhase("recording");
    const abort = { aborted: false };
    voiceAbortRef.current = abort;
    setIsListening(true);

    try {
      // Lazy-load so the route bundle stays light. The module memoizes the
      // pipeline so subsequent calls reuse it.
      const { transcribe } = await import("./_voice/whisper");
      const result = await transcribe(abort, {
        onProgress: ({ progress }) => {
          setVoicePhase("downloading");
          setVoiceProgress(progress);
        },
      });

      // The recording finished — flip to transcribing briefly so the UI
      // shows the model is working even if download already happened.
      if (!abort.aborted) setVoicePhase("transcribing");

      if (!result.ok) {
        const friendly = humanizeVoiceFailure(result.reason);
        setVoiceError(friendly);
        setToast(friendly);
        return;
      }

      const transcript = result.text.trim();
      if (!transcript) {
        setToast("I couldn't hear that clearly. Try once more or type it.");
        return;
      }
      if (target === "planner") {
        setBrainDump((current) => `${current}${current ? "\n" : ""}${transcript}`);
      } else {
        setCoachInput((current) => `${current}${current ? " " : ""}${transcript}`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Voice note failed.";
      setVoiceError(detail);
      setToast(detail);
    } finally {
      setIsListening(false);
      voiceAbortRef.current = null;
      // Small delay so the "Transcribing…" state is visible for sub-second
      // runs — otherwise it flashes too fast to read.
      window.setTimeout(() => setVoicePhase("idle"), 600);
      setVoiceProgress(0);
    }
  }

  function humanizeVoiceFailure(reason: "mic-denied" | "mic-unavailable" | "unsupported-browser" | "transcribe-failed"): string {
    switch (reason) {
      case "mic-denied":
        return "Microphone is blocked. Allow mic access in your browser settings, then try again.";
      case "mic-unavailable":
        return "No microphone found. Plug one in or type your note instead.";
      case "unsupported-browser":
        return "Voice notes need a recent Chrome, Edge, or Safari. Type your note instead.";
      case "transcribe-failed":
      default:
        return "Voice transcription failed this time. Type your note, or try again in a moment.";
    }
  }

  function voiceIconName(phase: typeof voicePhase, listening: boolean): IconName {
    if (phase === "downloading" || phase === "transcribing") return "spark";
    if (listening) return "pause";
    return "mic";
  }

  function voiceButtonLabel(phase: typeof voicePhase, listening: boolean, progress: number): string {
    if (phase === "downloading") return `Downloading model… ${Math.round(progress * 100)}%`;
    if (phase === "transcribing") return "Transcribing…";
    if (listening) return "Listening… tap to stop";
    return "Voice note";
  }

  function voiceStatusLabel(phase: typeof voicePhase, progress: number): string {
    if (phase === "downloading") return `One-time download (~140MB) — ${Math.round(progress * 100)}%. Cached for next time.`;
    if (phase === "transcribing") return "Running locally. Nothing leaves this device.";
    if (phase === "recording") return "Recording… tap stop when done.";
    if (phase === "error") return "Voice note failed.";
    return "";
  }

  async function sendCoachMessage() {
    const text = coachInput.trim();
    if (!text || coachPending) return;
    setCoachError("");
    setCoachPending(true);
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, context: buildCoachContext() }),
      });
      const data = (await response.json()) as { reply?: string; error?: string };
      if (!response.ok || !data.reply) {
        throw new Error(data.error ?? `Coach failed (${response.status})`);
      }
      setCoachMessages((current) => [
        ...current, 
        { from: "user" as const, text },
        { from: "coach" as const, text: data.reply }
      ]);
      setCoachInput("");
      window.localStorage.removeItem("mizan-draft-coach");
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI is unavailable right now.";
      setCoachError(message);
      // Phase 2: don't clear coachInput or add user message. 
      // Add a system coach message about the failure.
      setCoachMessages((current) => [
        ...current,
        {
          from: "coach" as const,
          text: "I can't reach the analysis engine right now — your message is saved in the box. Try again in a moment; nothing is lost.",
        },
      ]);
    } finally {
      setCoachPending(false);
    }
  }

  return (
    <div className="mizan-app">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>M</span></div>
          <div><strong>Mizan</strong><small>Life operating system</small></div>
        </div>

        <nav className="main-nav" aria-label="Main navigation">
          <p className="nav-label">Your system</p>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "nav-item active" : "nav-item"}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => { setView(item.id); setMobileOpen(false); }}
            >
              <Icon name={item.icon}/><span>{item.label}</span>
              {item.id === "today" && <span className="nav-count">{tasks.filter((task) => !task.done).length}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="level-card">
            <div className="level-card-top"><span>Overall rank</span><strong>—</strong></div>
            <div className="level-track"><span style={{ width: "0%" }}/></div>
            <p>Complete real work to earn a rank. No fake levels.</p>
          </div>
          <button className="profile-row" onClick={() => setView("life")}>
            <span className="avatar">M</span>
            <span><strong>Mohamed</strong><small>Private workspace</small></span>
            <Icon name="arrow" size={15}/>
          </button>
        </div>
      </aside>

      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close menu" onClick={() => setMobileOpen(false)}/>} 

      <main className="workspace" id="main-content">
        {dataNotice && (
          <div className="data-notice" role="status" aria-live="polite">
            <Icon name="spark" size={14}/>
            <p>{dataNotice}</p>
            <button className="icon-button" aria-label="Dismiss notice" onClick={() => setDataNotice("")}><Icon name="close" size={14}/></button>
          </div>
        )}
        <header className="topbar" role="banner">
          <button className="mobile-menu" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Icon name="menu"/></button>
          <div className="date-block"><span>{weekdayLabel}</span><strong>{dateLabel}</strong></div>
          <div className="mode-switch" aria-label="Day mode">
            {(["grinding", "recovery", "vacation"] as DayMode[]).map((item) => (
              <button key={item} className={mode === item ? "selected" : ""} onClick={() => chooseMode(item)}>
                {item === "grinding" ? "Grinding" : item === "recovery" ? "Recovery" : "Vacation"}
              </button>
            ))}
          </div>
          <button className="plan-button" aria-label={tomorrowTasks.length ? "Tomorrow planned" : "Plan tomorrow"} onClick={() => setPlannerOpen(true)}><Icon name={tomorrowTasks.length ? "check" : "moon"}/><span>{tomorrowTasks.length ? "Tomorrow planned" : "Plan tomorrow"}</span></button>
        </header>

        {view === "today" && (
          <div className="page today-page">
            <section className="welcome-row momentum-hero">
              <div className="welcome-copy">
                <p className="eyebrow">Assalamu alaykum, Mohamed</p>
                <h1>{mode === "vacation" ? "Be fully here today." : mode === "recovery" ? "Recover without losing yourself." : "Make today count."}</h1>
                <div className="momentum-signals" aria-label="Today’s momentum">
                  <span><Icon name="target" size={15}/><b>{completedTaskCount}/{visibleTasks.length}</b> missions moved</span>
                  {mode !== "vacation" && <span><Icon name="clock" size={15}/><b>{remainingFocusMinutes}m</b> to the 4h target</span>}
                </div>
              </div>
              <div className="day-score" style={{ "--day-score": `${dailyScore * 3.6}deg` } as CSSProperties} aria-label={`Day power ${dailyScore} out of 100`} aria-live="polite" aria-atomic="true">
                <div className="score-ring"><strong>{dailyScore}</strong><small>/100</small></div>
                <span>Day power</span>
              </div>
            </section>

            <div className="mobile-mode-switch" aria-label="Day mode">
              {(["grinding", "recovery", "vacation"] as DayMode[]).map((item) => (
                <button key={item} className={mode === item ? "selected" : ""} onClick={() => chooseMode(item)}>
                  {item === "grinding" ? "Grinding" : item === "recovery" ? "Recovery" : "Vacation"}
                </button>
              ))}
            </div>

            {tomorrowTasks.length > 0 && (
              <section className="tomorrow-preview" aria-label="Tomorrow’s plan">
                <div className="tomorrow-preview-head">
                  <div>
                    <p className="eyebrow">Tomorrow</p>
                    <h2>{tomorrowTasks.length} {tomorrowTasks.length === 1 ? "task" : "tasks"} queued</h2>
                  </div>
                  <button className="text-button" onClick={() => setPlannerOpen(true)}>Review <Icon name="arrow" size={14}/></button>
                </div>
                <ul>
                  {tomorrowTasks.slice(0, 3).map((task) => (
                    <li key={task.id}>
                      <span>{task.category}</span>
                      <strong>{task.title}</strong>
                      <small>{task.range}</small>
                    </li>
                  ))}
                  {tomorrowTasks.length > 3 && <li className="more">+{tomorrowTasks.length - 3} more</li>}
                </ul>
              </section>
            )}

            <section className="status-section" aria-labelledby="status-title">
              <div className="section-heading compact"><div><p className="eyebrow">Current status</p><h2 id="status-title">Your life pulse</h2></div><button className="text-button" onClick={() => setView("life")}>Full life map <Icon name="arrow" size={14}/></button></div>
              {/* Phase 7: the old strip rendered fake per-area scores (82, +5%,
                  "Momentum", etc.) with no underlying data source. Until a
                  real signal source is wired in, we show an honest empty
                  state instead of fabricating numbers. */}
              <div className="status-strip status-strip-empty" aria-live="polite">
                <p>Not enough data yet. Complete real work, prayers, and recovery for a few days and Mizan will read your pulse from behavior — never invented numbers.</p>
                <div className="status-strip-areas">
                  {lifeAreas.map((area) => (
                    <span className={`status-cell-flat ${area.color}`} key={area.name}>{area.name}</span>
                  ))}
                </div>
              </div>
            </section>

            <div className="today-grid">
              <section className="panel daily-panel" aria-labelledby="daily-title">
                <div className="section-heading">
                  <div><p className="eyebrow">Today’s direction</p><h2 id="daily-title">{mode === "vacation" ? "Vacation Day" : mode === "recovery" ? "Minimum viable day" : "Daily missions"}</h2></div>
                  {mode !== "vacation" && <div className="focus-total"><Icon name="clock"/><span><strong>{Math.floor(focusMinutes / 60)}h {focusMinutes % 60}m</strong> / 4h</span></div>}
                </div>

                {mode === "vacation" ? (
                  <div className="vacation-state">
                    <div className="vacation-mark"><Icon name="sun" size={28}/></div>
                    <h3>No work today.</h3>
                    <p>Be with your family or friends. Watch the match. Explore the world. Recreation is part of a life worth working for.</p>
                    <div className="vacation-essentials"><span><Icon name="moon"/> Prayer remains</span><span><Icon name="heart"/> Health stays gentle</span></div>
                  </div>
                ) : (
                  <>
                    <div className="focus-command">
                      <div className="focus-progress-wrap">
                        <div className="focus-meter"><span style={{ width: `${focusProgress}%` }}/></div>
                        <p><b>{focusProgress}%</b> of today’s protected focus complete</p>
                      </div>
                      <button className={activeTaskId ? "mission-start active" : "mission-start"} onClick={startNextMission}>
                        <Icon name="flame" size={16}/>
                        {activeTaskId ? "Mission in focus" : "Start next mission"}
                        <Icon name="arrow" size={15}/>
                      </button>
                    </div>
                    <div className="task-list">
                      {visibleTasks.map((task, index) => (
                        editingTaskId === task.id ? (
                          <TaskEditor 
                            key={task.id}
                            initialTitle={task.title}
                            initialRange={task.range}
                            initialMinutes={task.minutes}
                            initialCategory={task.category}
                            initialKind={task.kind}
                            initialDetails={task.details}
                            initialLinkedGoalId={task.linkedGoalId}
                            goalHorizons={goalHorizonsState}
                            showKind={false}
                            onSave={(patch) => updateTask(task.id, patch)}
                            onCancel={() => setEditingTaskId(null)}
                          />
                        ) : (
                          <div className={`task-row ${task.done ? "done" : ""} ${task.id === nextTask?.id ? "is-next" : ""} ${task.id === activeTaskId ? "in-focus" : ""}`} key={task.id}>
                            <button className="task-check" aria-label={`${task.done ? "Reopen" : "Complete"} ${task.title}`} onClick={() => toggleTask(task.id)}>{task.done && <Icon name="check" size={15}/>}</button>
                            <div className="task-index">{String(index + 1).padStart(2, "0")}</div>
                            <div className="task-copy"><div className="task-meta">{task.id === nextTask?.id && <span className="next-badge">{task.id === activeTaskId ? "In focus" : "Next move"}</span>}<span className={`category-pill category-${task.category.toLowerCase()}`}>{task.category}</span>{task.rolled > 0 && <span className={`rollover ${task.rolled >= 4 ? "danger" : ""}`}>Rolled {task.rolled}/4</span>}</div><h3>{task.title}</h3>{task.details && <p className="task-details-text">{task.details}</p>}<p>{task.range} · {task.minutes} min</p></div>
                            <button className="icon-button task-edit-trigger" aria-label="Edit task" onClick={() => setEditingTaskId(task.id)}><Icon name="spark" size={16} /></button>
                          </div>
                        )
                      ))}
                      {editingTaskId === "new" && (
                        <TaskEditor
                          initialTitle=""
                          initialRange="Flexible"
                          initialMinutes={60}
                          initialCategory="Business"
                          initialKind={newTaskKind}
                          initialDetails=""
                          initialLinkedGoalIds={[]}
                          goalHorizons={goalHorizonsState}
                          showKind={true}
                          onSave={(patch) => {
                            const id = Date.now();
                            setTasks(current => [...current, { id, done: false, rolled: 0, title: patch.title!, category: patch.category as Category, range: patch.range!, minutes: patch.minutes!, kind: patch.kind! as "mission"|"support", details: patch.details, linkedGoalIds: patch.linkedGoalIds }]);
                            setEditingTaskId(null);
                          }}
                          onCancel={() => setEditingTaskId(null)}
                        />
                      )}
                    </div>
                    <div className="add-task-actions">
                      <button className="text-button" onClick={() => { setNewTaskKind("mission"); setEditingTaskId("new"); }}><Icon name="plus" size={14}/> Add mission</button>
                      <button className="text-button" onClick={() => { setNewTaskKind("support"); setEditingTaskId("new"); }}><Icon name="plus" size={14}/> Add support</button>
                    </div>
                    {stuckMessage && <div className="stuck-response" role="status" aria-live="polite"><Icon name="spark"/><div><strong>{stuckFallback ? "Five-minute move (offline)" : "Your five-minute move"}</strong><p>{stuckMessage}</p>{stuckFallback && <small>Coach endpoint unreachable — showing a local heuristic. Try again later for an AI move.</small>}</div><button onClick={() => setStuckMessage("")} aria-label="Dismiss"><Icon name="close" size={15}/></button></div>}
                    <div className="daily-actions"><button className="secondary-action" onClick={helpMeStart} disabled={stuckPending}><Icon name="spark"/> {stuckPending ? "Thinking…" : "I’m stuck"}</button><button className="primary-action" onClick={() => setPlannerOpen(true)}><Icon name="plus"/> Arrange tasks</button></div>
                  </>
                )}
              </section>

              <aside className="right-column">
                <section className="panel prayer-panel">
                  <div className="panel-title-row"><div><p className="eyebrow">Cairo · Today</p><h2>Prayer rhythm</h2></div><span className="prayer-count">{prayerProgress}/5</span></div>
                  <div className="prayer-list">
                    {prayers.map((prayer) => (
                      <button className={prayer.done ? "prayer done" : "prayer"} key={prayer.name} onClick={() => togglePrayer(prayer.name)}>
                        <span className="prayer-check">{prayer.done && <Icon name="check" size={13}/>}</span><strong>{prayer.name}</strong><time dateTime={prayerTimeIso(prayer.time)} aria-label={`${prayer.name} at ${prayer.time}`}>{prayer.time}</time>
                      </button>
                    ))}
                  </div>
                  <button className={quranDone ? "quran-dose done" : "quran-dose"} onClick={() => setQuranDone((done) => !done)}><Icon name={quranDone ? "check" : "book"}/><div><strong>{quranDone ? "Quran complete" : "Daily Quran"}</strong><span>10 minutes · after Maghrib</span></div><Icon name="arrow" size={15}/></button>
                </section>

                <section className="panel challenge-panel">
                  <div className="panel-title-row">
                    <div><p className="eyebrow">Personality grind · {highestTierDone + 1}/3</p><h2>Courage rep</h2></div>
                    {!writingChallenge && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="icon-button" aria-label="Write your own" onClick={() => { setDraftChallenge(""); setWritingChallenge(true); }}><Icon name="plus" size={14}/></button>
                        <button className="icon-button" aria-label="Draw another challenge" onClick={drawChallenge}><Icon name="spark"/></button>
                      </div>
                    )}
                  </div>
                  {writingChallenge ? (
                    <div className="challenge-write">
                      <textarea className="task-edit-field" rows={2} autoFocus value={draftChallenge} onChange={(e) => setDraftChallenge(e.target.value)} placeholder="Write your own courage rep..." style={{ width: "100%", marginBottom: "12px", background: "rgba(255,255,255,0.5)", borderColor: "#d5bda4" }} />
                      <div className="challenge-actions" style={{ marginTop: 0 }}>
                        <button className="challenge-complete active" onClick={() => { if (draftChallenge.trim()) setChallenge(draftChallenge.trim()); setWritingChallenge(false); }}>Set rep</button>
                        <button className="draw-another-btn" onClick={() => setWritingChallenge(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <blockquote>“{challenge}”</blockquote>
                      <div className="challenge-actions">
                        <button className={challengeDone ? "challenge-complete active" : "challenge-complete"} onClick={markChallengeDone}><Icon name="check"/> {challengeDone ? "Rep complete" : "Mark complete"}</button>
                        <button onClick={drawChallenge}>Draw another</button>
                      </div>
                    </>
                  )}
                </section>
              </aside>
            </div>

            <section className="big-goal-section">
              <div className="big-goal-copy"><p className="eyebrow">The biggest goal</p><h2>A life of wealth, strength<br/>and closeness to God.</h2><p>Build toward $1B+ without arriving empty. Protect faith, health, family and the mind capable of carrying it.</p><button onClick={() => setView("goals")}>See the path <Icon name="arrow" size={16}/></button></div>
              <div className="goal-pillars">
                <div><span>01</span><strong>$1B+</strong><p>Build value at an extraordinary scale.</p></div>
                <div><span>02</span><strong>Strong body</strong><p>Healthy, capable and resilient.</p></div>
                <div><span>03</span><strong>Strong faith</strong><p>Prayer and purpose stay central.</p></div>
              </div>
            </section>

            <section className="checkin-section">
              <div><p className="eyebrow">30-second check-in</p><h2>Give the system today’s context.</h2></div>
              <div className="checkin-controls">
                {(["energy", "pain", "focus"] as const).map((metric) => (
                  <div className="checkin-control" key={metric}><span>{metric}</span><div>{[1,2,3,4,5].map((value) => <button key={value} className={checkIn[metric] === value ? "active" : ""} aria-label={`${metric} ${value} of 5`} onClick={() => setCheckIn((current) => ({ ...current, [metric]: value }))}>{value}</button>)}</div></div>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === "goals" && (
          <GoalsView 
            horizons={goalHorizonsState} 
            onBack={() => setView("today")}
            onUpdateHorizon={updateHorizon}
            onAddGoal={addGoalToHorizon}
            onRemoveGoal={removeGoalFromHorizon}
          />
        )}
        {view === "insights" && (
          <InsightsView
            dailyScore={dailyScore}
            insights={insights}
            pending={insightsPending}
            error={insightsError}
            onOpenHistory={() => setView("history")}
          />
        )}
        {view === "history" && (
          <HistoryView
            pastTasks={pastTasks}
            onBack={() => setView("insights")}
          />
        )}
        {view === "coach" && (
          <CoachView
            messages={coachMessages}
            contextNotes={contextNotes}
            onAddNote={addContextNote}
            onUpdateNote={updateContextNote}
            onRemoveNote={removeContextNote}
            input={coachInput}
            setInput={setCoachInput}
            send={sendCoachMessage}
            listen={() => startVoice("coach")}
            listening={isListening}
            voicePhase={voicePhase}
            voiceProgress={voiceProgress}
            voiceError={voiceError}
            pending={coachPending}
            error={coachError}
          />
        )}
        {view === "life" && <LifeMapView insights={insights} pending={insightsPending} error={insightsError}/>}
        <footer className="app-footer" aria-label="About this workspace">
          <p>Mizan is a private life operating system. Nothing leaves this device unless you explicitly call the AI coach or arranger.</p>
        </footer>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon name={item.icon}/><span>{item.label === "Life map" ? "Life" : item.label}</span></button>)}
      </nav>

      {plannerOpen && (
        <div className="modal-layer" role="presentation">
          <button className="modal-backdrop" aria-label="Close planner" onClick={() => setPlannerOpen(false)}/>
          <section className="planner-sheet" role="dialog" aria-modal="true" aria-labelledby="planner-title">
            <div className="sheet-header"><div><p className="eyebrow">Evening planning</p><h2 id="planner-title">Empty your mind. I’ll arrange it.</h2></div><button className="icon-button" aria-label="Close" onClick={() => setPlannerOpen(false)}><Icon name="close"/></button></div>
            <p className="sheet-intro">Tell me what must happen, what feels uncertain, and any fixed commitments. Nothing becomes final until you approve it.</p>
            <div className="brain-dump-wrap"><textarea value={brainDump} onChange={(event) => setBrainDump(event.target.value)} placeholder="Example: test HustleIQ with real users, physiotherapy at 2, call two agencies, record YouTube intro…" rows={6}/><button className={isListening || voicePhase !== "idle" ? "voice-button listening" : "voice-button"} onClick={() => startVoice("planner")}><Icon name={voiceIconName(voicePhase, isListening)}/>{voiceButtonLabel(voicePhase, isListening, voiceProgress)}</button>{voicePhase !== "idle" && <span className="voice-status">{voiceStatusLabel(voicePhase, voiceProgress)}</span>}</div>
            <label className="checkbox-label" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={offlinePlannerMode} onChange={(e) => setOfflinePlannerMode(e.target.checked)} />
              Use offline algorithm instead of AI
            </label>
            <button className="arrange-button" onClick={arrangePlan} disabled={arrangePending}><Icon name={offlinePlannerMode ? "check" : "spark"}/> {arrangePending ? "Arranging…" : "Arrange tomorrow"}</button>
            {arrangeError && arrangeFallback && <div className="arrange-notice" role="status"><Icon name="spark" size={14}/><span><strong>{offlinePlannerMode ? "Offline algorithm." : "AI offline."}</strong> {arrangeError} A keyword-based arrangement is shown below — edit times before approving.</span></div>}
            {draftTasks.length > 0 && <div className="draft-plan"><div className="draft-heading"><strong>Proposed plan</strong><span>You still decide</span></div>{draftTasks.map((task, index) => editingDraftIndex === index ? (
              <TaskEditor key={`draft-${index}`} initialTitle={task.title} initialRange={task.range} initialMinutes={task.minutes} initialCategory={task.category} initialKind={task.kind} initialDetails={task.details} initialLinkedGoalIds={task.linkedGoalIds} goalHorizons={goalHorizonsState} showKind={true} onSave={(patch) => updateDraftTask(index, patch)} onCancel={() => setEditingDraftIndex(null)} />
            ) : (
              <div className="draft-row" key={`${task.title}-${index}`}><span>{String(index + 1).padStart(2,"0")}</span><div><strong>{task.title}</strong>{task.details && <p className="task-details-text">{task.details}</p>}<small>{task.category} · {task.range}</small></div><button className="icon-button task-edit-trigger" onClick={() => setEditingDraftIndex(index)}><Icon name="spark" /></button></div>
            ))}{(arrangeReasoning || arrangeFallback) && <div className={`logic-note ${arrangeFallback ? "logic-note-fallback" : ""}`}><Icon name="brain"/><p><strong>{arrangeFallback ? "Why this order (offline):" : "Why this order:"}</strong> {arrangeReasoning || "User validation comes before more polishing. Rehabilitation protects recovery. Learning stays after the day’s real outcomes."}</p></div>}<button className="approve-button" onClick={approvePlan}>Approve this plan <Icon name="check"/></button></div>}
            {draftTasks.length === 0 && tomorrowTasks.length > 0 && (
              <div className="draft-plan approved-plan" aria-label="Approved plan for tomorrow">
                <div className="draft-heading"><strong>Tomorrow is set</strong><span>{tomorrowTasks.length} {tomorrowTasks.length === 1 ? "task" : "tasks"}</span></div>
                {tomorrowTasks.map((task, index) => editingTomorrowId === task.id ? (
                  <TaskEditor key={task.id} initialTitle={task.title} initialRange={task.range} initialMinutes={task.minutes} initialCategory={task.category} initialKind={task.kind} initialDetails={task.details} initialLinkedGoalIds={task.linkedGoalIds} goalHorizons={goalHorizonsState} showKind={true} onSave={(patch) => updateTomorrowTask(task.id, patch)} onCancel={() => setEditingTomorrowId(null)} />
                ) : (
                  <div className="draft-row approved-row" key={task.id ?? index}>
                    <span>{String(index + 1).padStart(2,"0")}</span>
                    <div><strong>{task.title}</strong>{task.details && <p className="task-details-text">{task.details}</p>}<small>{task.category} · {task.range}</small></div>
                    <div className="approved-row-actions">
                      <button className="icon-button task-edit-trigger" aria-label="Edit task" onClick={() => setEditingTomorrowId(task.id)}><Icon name="spark"/></button>
                      <button className="icon-button remove-tomorrow" aria-label={`Remove “${task.title}” from tomorrow`} onClick={() => removeTomorrowTask(task.id)}><Icon name="close"/></button>
                    </div>
                  </div>
                ))}
                <div className="approved-actions">
                  <button className="secondary-action scrap-button" onClick={scrapTomorrowPlan}>Scrap and replan</button>
                  <button className="secondary-action" onClick={() => setPlannerOpen(false)}>Done</button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {rolloverReviewOpen && tasks.some((task) => !task.done && task.rolled >= 4) && (
        <div className="modal-layer" role="presentation">
          <button className="modal-backdrop" aria-label="Close rollover review" onClick={() => setRolloverReviewOpen(false)}/>
          <section className="planner-sheet rollover-sheet" role="dialog" aria-modal="true" aria-labelledby="rollover-title">
            <div className="sheet-header"><div><p className="eyebrow">Rollover review</p><h2 id="rollover-title">Some tasks have rolled four times.</h2></div><button className="icon-button" aria-label="Close" onClick={() => setRolloverReviewOpen(false)}><Icon name="close"/></button></div>
            <p className="sheet-intro">Rolling a task forever hides the truth: it may be the wrong task, the wrong time, or something you’ve outgrown. Decide what each one deserves.</p>
            <div className="rollover-list">
              {tasks.filter((task) => !task.done && task.rolled >= 4).map((task) => (
                <div className="rollover-row" key={task.id}>
                  <div className="rollover-row-copy">
                    <span className={`category-pill category-${task.category.toLowerCase()}`}>{task.category}</span>
                    <strong>{task.title}</strong>
                    <small>{task.range} · {task.minutes} min · rolled {task.rolled}/4</small>
                  </div>
                  <div className="rollover-row-actions">
                    <button className="secondary-action" onClick={() => resetRollover(task.id)}>Keep</button>
                    <button className="secondary-action danger-action" onClick={() => dropTask(task.id)}>Drop</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="rollover-foot">
              <button className="secondary-action" onClick={() => setRolloverReviewOpen(false)}>Review later</button>
              <p>“Review later” leaves the tasks in place. They will not be auto-deleted.</p>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><span><Icon name="check" size={15}/></span>{toast}</div>}
    </div>
  );
}

function MultiGoalSelect({
  label,
  horizons,
  selectedGoalIds,
  onChange,
}: {
  label: string;
  horizons: Horizon[];
  selectedGoalIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="task-edit-field" onClick={() => setOpen(!open)} style={{ cursor: 'pointer', textAlign: 'left', minWidth: '120px' }}>
        {label} ({selectedGoalIds.length})
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            zIndex: 10,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: '6px',
            padding: '12px',
            marginBottom: '4px',
            maxHeight: '300px',
            overflowY: 'auto',
            boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
            minWidth: '250px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            {horizons.map(h => (
              <div key={h.label} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>{h.label}</div>
                {h.goals.map(g => (
                  <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--text)' }}>
                    <input 
                      type="checkbox" 
                      checked={selectedGoalIds.includes(g.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          onChange([...selectedGoalIds, g.id]);
                        } else {
                          onChange(selectedGoalIds.filter(id => id !== g.id));
                        }
                      }}
                    />
                    {g.title}
                  </label>
                ))}
                {h.goals.length === 0 && <div style={{ fontSize: '12px', color: 'var(--muted)', padding: '2px 0' }}>No goals</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TaskEditor({
  initialTitle,
  initialRange,
  initialMinutes,
  initialCategory,
  initialKind,
  initialDetails,
  initialLinkedGoalIds,
  goalHorizons,
  showKind,
  onSave,
  onCancel,
}: {
  initialTitle: string;
  initialRange: string;
  initialMinutes: number;
  initialCategory: Category;
  initialKind: "mission" | "support";
  initialDetails?: string;
  initialLinkedGoalIds?: string[];
  goalHorizons: Horizon[];
  showKind: boolean;
  onSave: (patch: Partial<Task>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [range, setRange] = useState(initialRange);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [category, setCategory] = useState<Category>(initialCategory);
  const [kind, setKind] = useState<"mission" | "support">(initialKind);
  const [details, setDetails] = useState(initialDetails || "");
  const [linkedGoalIds, setLinkedGoalIds] = useState<string[]>(initialLinkedGoalIds || []);

  return (
    <div className="task-edit-inline">
      <div className="task-edit-fields">
        <input className="task-edit-field flex-grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" />
        <input className="task-edit-field" value={range} onChange={(e) => setRange(e.target.value)} placeholder="Time (e.g. 10:30 am)" />
        <input className="task-edit-field number-field" type="number" value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 0)} placeholder="Min" />
        <select className="task-edit-field" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {lifeAreas.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
        </select>
        {showKind && (
          <select className="task-edit-field" value={kind} onChange={(e) => setKind(e.target.value as "mission" | "support")}>
            <option value="mission">Mission</option>
            <option value="support">Support</option>
          </select>
        )}
        <MultiGoalSelect
          label="Goals"
          horizons={goalHorizons}
          selectedGoalIds={linkedGoalIds}
          onChange={setLinkedGoalIds}
        />
      </div>
      <textarea className="task-edit-field" style={{ width: '100%', marginTop: '8px', minHeight: '60px', background: 'transparent' }} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Optional details or bullet points..." />
      <div className="task-edit-actions">
        <button onClick={onCancel} className="secondary-action">Cancel</button>
        <button onClick={() => onSave({ title, range, minutes, category, kind, details: details.trim() || undefined, linkedGoalIds })} className="primary-action">Save</button>
      </div>
    </div>
  );
}

function GoalsView({ 
  horizons,
  onBack,
  onUpdateHorizon,
  onAddGoal,
  onRemoveGoal
}: { 
  horizons: Horizon[];
  onBack: () => void;
  onUpdateHorizon: (index: number, patch: Partial<Horizon>) => void;
  onAddGoal: (index: number, goal: Goal) => void;
  onRemoveGoal: (horizonIndex: number, goalIndex: number) => void;
}) {
  const [editingHorizonIndex, setEditingHorizonIndex] = useState<number | null>(null);
  const [newGoalText, setNewGoalText] = useState("");

  const handleSaveGoal = (hIndex: number) => {
    onAddGoal(hIndex, { id: crypto.randomUUID(), title: newGoalText, tasksDone: 0 });
    setNewGoalText("");
  };

  const calculateProgress = (horizon: Horizon) => {
    if (!horizon.startDate || !horizon.targetDate) return horizon.progress || 0;
    const start = new Date(horizon.startDate).getTime();
    const end = new Date(horizon.targetDate).getTime();
    const now = new Date().getTime();
    if (end <= start) return 100;
    if (now <= start) return 0;
    if (now >= end) return 100;
    return Math.round(((now - start) / (end - start)) * 100);
  };

  return <div className="page subpage goals-page">
    <div className="subpage-heading"><div><p className="eyebrow">Direction over distraction</p><h1>Your goals</h1><p>Today only matters because it belongs to something larger.</p></div><button className="secondary-action" onClick={onBack}>Return to today</button></div>
    <section className="goal-hero"><div><p className="eyebrow">The biggest goal</p><h2>Build extraordinary wealth.<br/>Stay healthy. Stay close to God.</h2><p>The number is not the identity. The identity is becoming capable of creating vast value without sacrificing the foundations that make the success worth having.</p></div><div className="goal-hero-number"><span>North star</span><strong>$1B+</strong><small>Net worth · long horizon</small></div></section>
    <div className="horizon-grid">
      {horizons.map((horizon, hIndex) => {
        const computedProgress = calculateProgress(horizon);
        const nextHorizon = horizons[hIndex + 1];
        return (
        <section className="horizon-card" key={horizon.label}>
          {editingHorizonIndex === hIndex ? (
            <div className="horizon-edit" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Horizon Label</label>
                  <input className="task-edit-field" value={horizon.label} onChange={(e) => onUpdateHorizon(hIndex, { label: e.target.value })} placeholder="e.g. One Year" />
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Start Date</label>
                    <input className="task-edit-field" type="date" value={horizon.startDate || ""} onChange={(e) => onUpdateHorizon(hIndex, { startDate: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Target Date</label>
                    <input className="task-edit-field" type="date" value={horizon.targetDate || ""} onChange={(e) => onUpdateHorizon(hIndex, { targetDate: e.target.value })} />
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>Tracked Goals</label>
                <ul className="horizon-edit-goals" style={{ margin: 0 }}>
                  {horizon.goals.map((goal, gIndex) => (
                    <li key={gIndex} className="goal-edit-row" style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', padding: '8px', borderRadius: '6px', border: '1px solid var(--line)', gap: '8px', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '8px' }}>
                        <input className="task-edit-field flex-grow" style={{ border: 'none', background: 'transparent', padding: 0 }} value={goal.title} onChange={(e) => {
                          const newGoals = [...horizon.goals];
                          newGoals[gIndex] = { ...goal, title: e.target.value };
                          onUpdateHorizon(hIndex, { goals: newGoals });
                        }} placeholder="Goal title" />
                        <button className="icon-button" style={{ marginLeft: 'auto' }} onClick={() => onRemoveGoal(hIndex, gIndex)}><Icon name="close" /></button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--line)', paddingTop: '8px', width: '100%' }}>
                        {nextHorizon && (
                          <MultiGoalSelect
                            label="Parent Goals"
                            horizons={[nextHorizon]}
                            selectedGoalIds={goal.parentGoalIds || []}
                            onChange={(ids) => {
                              const newGoals = [...horizon.goals];
                              newGoals[gIndex] = { ...goal, parentGoalIds: ids };
                              onUpdateHorizon(hIndex, { goals: newGoals });
                            }}
                          />
                        )}
                        <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: nextHorizon ? '8px' : 'auto' }}>Tasks done:</span>
                        <input className="task-edit-field number-field" type="number" style={{ width: '60px', border: '1px solid var(--line)', padding: '2px 6px' }} value={goal.tasksDone} onChange={(e) => {
                          const newGoals = [...horizon.goals];
                          newGoals[gIndex] = { ...goal, tasksDone: Number(e.target.value) || 0 };
                          onUpdateHorizon(hIndex, { goals: newGoals });
                        }} placeholder="0" />
                      </div>
                    </li>
                  ))}
                  <li className="goal-edit-row">
                    <input className="task-edit-field flex-grow" placeholder="Add a new goal..." value={newGoalText} onChange={(e) => setNewGoalText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveGoal(hIndex)} />
                    <button className="secondary-action" onClick={() => handleSaveGoal(hIndex)}>Add Goal</button>
                  </li>
                </ul>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px' }}>
                <button className="primary-action" onClick={() => setEditingHorizonIndex(null)}>Done Editing</button>
              </div>
            </div>
          ) : (
            <>
              <div className="horizon-top">
                <span>{horizon.label} {horizon.targetDate && <small className="horizon-date">({horizon.targetDate})</small>}</span>
                <strong>{computedProgress}% <button className="icon-button horizon-edit-trigger" onClick={() => setEditingHorizonIndex(hIndex)}><Icon name="spark" /></button></strong>
              </div>
              <div className="horizon-progress"><span style={{width:`${computedProgress}%`}}/></div>
              <ul className="horizon-goals-list">{horizon.goals.map((goal, gIndex) => (
                <li key={gIndex}>
                  <span/>
                  <p>{goal.title}</p>
                  <button className="goal-task-counter" onClick={() => {
                    const newGoals = [...horizon.goals];
                    newGoals[gIndex] = { ...goal, tasksDone: goal.tasksDone + 1 };
                    onUpdateHorizon(hIndex, { goals: newGoals });
                  }}><strong>{goal.tasksDone}</strong> tasks</button>
                </li>
              ))}</ul>
            </>
          )}
        </section>
      )})}
    </div>
  </div>;
}

function HistoryView({ pastTasks, onBack }: { pastTasks: { dateKey: string; tasks: Task[] }[]; onBack: () => void }) {
  return (
    <div className="page subpage history-page">
      <div className="subpage-heading">
        <div><p className="eyebrow">Look back</p><h1>Task history</h1><p>The last 30 days of completed missions.</p></div>
        <button className="secondary-action" onClick={onBack}>Back to insights</button>
      </div>
      <div className="history-list">
        {pastTasks.length === 0 ? <p className="history-empty">No history recorded yet.</p> : pastTasks.map(day => (
          <section key={day.dateKey} className="history-day">
            <h3>{day.dateKey}</h3>
            <ul>
              {day.tasks.map(task => (
                <li key={task.id} className={task.done ? "history-task done" : "history-task dropped"}>
                  <Icon name={task.done ? "check" : "close"} />
                  <div className="history-task-details">
                    <strong>{task.title}</strong>
                    <span>{task.category} • {task.kind} • {task.minutes}m</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function InsightsView({
  dailyScore,
  insights,
  pending,
  error,
  onOpenHistory,
}: {
  dailyScore: number;
  insights: {
    headline: string;
    stat: string;
    risk: string;
    lifeMap: Array<{ name: string; insight: string }>;
    emptyState?: boolean;
    fallback?: boolean;
  } | null;
  pending: boolean;
  error: string;
  onOpenHistory: () => void;
}) {
  const insight = insights;
  const loadingText = pending ? "Reading your patterns…" : error ? "Insights unavailable right now." : "Not enough data yet.";
  return <div className="page subpage insights-page">
    <div className="subpage-heading">
      <div><p className="eyebrow">Calm, factual feedback</p><h1>Insights</h1><p>Your behavior is data, not a verdict.</p></div>
      <div className="subpage-heading-actions">
        <button className="secondary-action" onClick={onOpenHistory}><Icon name="calendar"/> Task history</button>
        <div className="record-chip"><Icon name="flame"/><span>Streak appears once you have real history</span></div>
      </div>
    </div>
    <div className="insight-grid">
      <section className="panel weekly-chart"><div className="section-heading"><div><p className="eyebrow">Against your best week</p><h2>Consistency score</h2></div><strong>{dailyScore}<small>/100</small></strong></div><div className="chart-area">{weeklyBars.length === 0 ? <div className="chart-empty" role="status"><p>No history yet.</p><small>Complete real work for a few days and this chart fills in from behavior — no fabricated bars.</small></div> : weeklyBars.map((value,index)=><div className="bar-column" key={index}><div className="best-marker" style={{bottom:`${Math.min(94,value+11)}%`}}/><div className="bar" style={{height:`${value}%`}}/><span>{["Th","Fr","Sa","Su","Mo","Tu","We"][index]}</span></div>)}</div><div className="chart-legend"><span><i className="solid"/> This week</span><span><i className="line"/> Best previous week</span></div></section>
      <section className="panel insight-summary">
        <p className="eyebrow">{insight?.emptyState ? "Not enough data yet" : "What the pattern says"}</p>
        {insight ? (
          <>
            <h2>{insight.headline}</h2>
            <p>{insight.stat}</p>
            {insight.risk && <><div className="insight-rule"/><h3>The risk</h3><p>{insight.risk}</p></>}
            {insight.fallback && <p className="insight-offline" role="status">Analysis engine offline — commentary above is a fallback. It will refresh on the next call.</p>}
          </>
        ) : (
          <>
            <h2>{loadingText}</h2>
            <p>Check in for a few days and complete real tasks. Mizan reads your behavior from there — never invents statistics.</p>
          </>
        )}
      </section>
    </div>
    <div className="record-grid record-grid-empty" role="status">
      <div className="record-empty-copy">
        <p>Records appear after your first full week of real activity.</p>
        <small>Earlier placeholder values were removed — they posed as measurements Mizan never made.</small>
      </div>
    </div>
  </div>;
}

function CoachView({
  messages,
  contextNotes,
  onAddNote,
  onUpdateNote,
  onRemoveNote,
  input,
  setInput,
  send,
  listen,
  listening,
  voicePhase,
  voiceProgress,
  voiceError,
  pending,
}: {
  messages: {from:"coach"|"user";text:string}[];
  contextNotes: string[];
  onAddNote: (text: string) => void;
  onUpdateNote: (index: number, text: string) => void;
  onRemoveNote: (index: number) => void;
  input:string;
  setInput:(value:string)=>void;
  send:()=>void;
  listen:()=>void;
  listening:boolean;
  voicePhase: "idle" | "recording" | "downloading" | "transcribing" | "error";
  voiceProgress: number;
  voiceError: string;
  pending:boolean;
}) {
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [newNoteText, setNewNoteText] = useState("");
  const voiceActive = listening || (voicePhase !== "idle" && voicePhase !== "error");
  const voiceLabel = voicePhase === "downloading"
    ? `Downloading… ${Math.round(voiceProgress * 100)}%`
    : voicePhase === "transcribing"
      ? "Transcribing…"
      : listening
        ? "Listening… tap to stop"
        : "Voice note";
  
  const handleSaveNewNote = () => {
    onAddNote(newNoteText);
    setNewNoteText("");
  };

  return <div className="page subpage coach-page"><div className="subpage-heading"><div><p className="eyebrow">Your context, remembered</p><h1>Mizan Coach</h1><p>Strategic when planning. Firm when avoiding. Calm when recovering.</p></div><span className="private-badge"><span/> Private conversation</span></div><section className="coach-shell"><div className="coach-context"><div className="coach-orb"><Icon name="spark" size={24}/></div><h2>I know what you are balancing.</h2><p>Mizan remembers these priorities and uses them to shape every conversation.</p><ul className="context-list editable-list">{contextNotes.map((note, index) => <li key={index}>{editingNoteIndex === index ? <div className="note-edit-row"><input className="task-edit-field flex-grow" value={note} onChange={(e) => onUpdateNote(index, e.target.value)} onBlur={() => setEditingNoteIndex(null)} autoFocus onKeyDown={(e) => e.key === 'Enter' && setEditingNoteIndex(null)} /><button className="icon-button" onMouseDown={(e) => { e.preventDefault(); onRemoveNote(index); }}><Icon name="close" /></button></div> : <div className="note-display-row" onClick={() => setEditingNoteIndex(index)}><span><Icon name="target" /> {note}</span><button className="icon-button"><Icon name="spark" size={14}/></button></div>}</li>)}<li className="note-add-row"><input className="task-edit-field flex-grow" placeholder="Add something you're balancing..." value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveNewNote()} /><button className="icon-button" onClick={handleSaveNewNote}><Icon name="plus" /></button></li></ul></div><div className="conversation"><div className="messages" aria-live="polite" aria-label="Conversation with Mizan coach">{messages.map((message,index)=><div className={`message ${message.from}`} key={index}>{message.from === "coach" && <span className="message-mark"><Icon name="spark" size={14}/></span>}<p>{message.text}</p></div>)}{pending && <div className="message coach message-pending"><span className="message-mark"><Icon name="spark" size={14}/></span><p>Mizan is thinking…</p></div>}</div><div className="composer"><textarea value={input} onChange={(event)=>setInput(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();send();}}} placeholder="Talk through your plans, uncertainty, pain, or priorities…" rows={2}/><div><button className={voiceActive?`composer-tool listening`:"composer-tool"} onClick={listen}><Icon name={voicePhase==="downloading"||voicePhase==="transcribing"?"spark":listening?"pause":"mic"}/>{voiceLabel}</button><button className="send-button" onClick={send} aria-label="Send message" disabled={pending}><Icon name="send"/></button></div>{voiceActive && <p className="composer-voice-status">{voicePhase === "downloading" ? `One-time download (~140MB) — ${Math.round(voiceProgress * 100)}%. Cached for next time.` : voicePhase === "transcribing" ? "Running locally. Nothing leaves this device." : "Recording… tap stop when done."}</p>}{voiceError && !voiceActive && <p className="composer-voice-error">{voiceError}</p>}</div></div></section></div>;
}

function LifeMapView({
  insights,
  pending,
  error,
}: {
  insights: {
    headline: string;
    stat: string;
    risk: string;
    lifeMap: Array<{ name: string; insight: string }>;
    emptyState?: boolean;
    fallback?: boolean;
  } | null;
  pending: boolean;
  error: string;
}) {
  const insightByArea = new Map((insights?.lifeMap ?? []).map((entry) => [entry.name.toLowerCase(), entry.insight]));
  return <div className="page subpage life-page"><div className="subpage-heading"><div><p className="eyebrow">Nothing important disappears</p><h1>Life map</h1><p>Every area has a status, a direction, and a next honest action.</p></div></div>
  {/* Phase 7: cards no longer show fabricated scores/deltas/ranks. The
      per-area insight from the AI (when available) is the only signal —
      otherwise we say so plainly. */}
  <div className="life-grid">{lifeAreas.map((area,index)=><section className={`life-card ${area.color}`} key={area.name}><div className="life-card-heading"><div className="life-icon"><Icon name={(["moon","heart","briefcase","book","brain","users","spark"] as IconName[])[index]}/></div><div><span>{area.name}</span><strong>—</strong></div><b>—</b></div><div className="life-progress"><span style={{width:`0%`}}/></div><p>{insightByArea.get(area.name.toLowerCase()) ?? (pending ? "Reading your patterns…" : error ? "Insight engine offline — refresh later." : "Needs more days of check-ins to read.")}</p><div className="life-card-foot"><span>No tracked delta yet</span><Icon name="chart" size={14}/></div></section>)}</div></div>;
}
