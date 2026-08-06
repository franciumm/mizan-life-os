/**
 * Shared types for the Mizan AI endpoints. Imported by both the route
 * handlers (server) and the dashboard (client) so the contract stays in one
 * place.
 */

export type DayMode = "grinding" | "recovery" | "vacation";

export type Category =
  | "Business"
  | "Health"
  | "Faith"
  | "College"
  | "Mind"
  | "Personality"
  | "Family";

export type CoachContext = {
  mode: DayMode;
  tasks: Array<{
    title: string;
    category: Category;
    range: string;
    minutes: number;
    done: boolean;
    kind: "mission" | "support";
    rolled: number;
  }>;
  prayers: Array<{ name: string; time: string; done: boolean }>;
  quranDone: boolean;
  checkIn: { energy: number; pain: number; focus: number };
  challenge?: string;
  challengeDone?: boolean;
  /**
   * Phase 7 stripped fabricated scores/deltas/ranks from lifeAreas — the
   * dashboard sends only the area name. The model and the fallback paths
   * must not compose strings from fields that aren't there.
   */
  lifeAreas: Array<{ name: string }>;
  /** User-curated notes describing what they are balancing right now. */
  contextNotes?: string[];
  /** ISO date key (Cairo). Used for one-per-day caching of insights. */
  dateKey: string;
};

export type CoachRequest = {
  message: string;
  context: CoachContext;
  /**
   * `mode: "stuck"` switches the route to a tight, action-only system prompt
   * (~60-100 output tokens). Used by helpMeStart / "I'm stuck" so the user
   * gets one concrete five-minute move instead of the conversation tone.
   */
  mode?: "stuck";
};

export type CoachResponse = {
  reply: string;
  /** Present when the model call failed and the route returned an explicit error. */
  error?: string;
};

export type ArrangeRequest = {
  brainDump: string;
  context: CoachContext;
};

export type ArrangePlan = {
  tasks: Array<{
    title: string;
    category: Category;
    range: string;
    minutes: number;
    kind: "mission" | "support";
  }>;
  overallReasoning: string;
};

export type ArrangeResponse = {
  plan: ArrangePlan;
  /** Present when the model call failed and the rule-based fallback fired. */
  fallback?: boolean;
  error?: string;
};

export type InsightsRequest = {
  context: CoachContext;
};

export type InsightsResponse = {
  headline: string;
  stat: string;
  risk: string;
  lifeMap: Array<{ name: string; insight: string }>;
  /** Present when there's not enough history to generate real commentary. */
  emptyState?: boolean;
  /** Present when the model call failed. */
  fallback?: boolean;
  error?: string;
};
