"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Section = "today" | "mission" | "focus" | "life" | "review";
type DayType = "home" | "content" | "short-college" | "long-college" | "social" | "recovery";
type Outcome = "" | "yes" | "partial" | "no";
type TriState = "na" | "yes" | "no";
type BalanceKey = "hustliq" | "college" | "mental" | "physical" | "content" | "relationships" | "learning" | "recreation";

type DailyEntry = {
  dayType: DayType;
  mustWin: string;
  supports: [string, string];
  growth: string;
  fun: string;
  done: Record<string, boolean>;
  morning: Record<string, boolean>;
  scrollMinutes: number;
  focusResult: string;
  focusMinutes: number;
  focusOutcome: Outcome;
  codeMinutes: number;
  codeFile: string;
  codeResponsibility: string;
  codeInput: string;
  codeOutput: string;
  codeDependencies: string;
  codeGap: string;
  codeExplanation: string;
  codeConfidence: number;
  filesUnderstood: number;
  aiUnderstanding: "yes" | "mostly" | "no";
  aiChange: string;
  contentPersonal: number;
  contentHustliq: number;
  collegeMinutes: number;
  japaneseMinutes: number;
  meaningfulConversation: boolean;
  socialAdventure: TriState;
  rehab: TriState;
  gym: TriState;
  movement: "low" | "medium" | "good";
  impulseOutcome: Outcome;
  emotions: Record<EmotionMetric, number>;
  reviewWorked: string;
  reviewFailed: string;
  reviewDistraction: string;
  reviewChange: string;
  balance: Record<BalanceKey, number>;
  // Commute mode: single choice saved per day
  commuteMode: string;
  // Intentional fun: multiple activities chosen per day
  funChoices: string[];
};

type EmotionMetric = "anxiety" | "numbness" | "motivation" | "focus" | "confidence" | "loneliness" | "mood";

type Episode = {
  id: string;
  dateKey: string;
  time: string;
  location: string;
  before: string;
  trigger: string;
  emotion: string;
  intensity: number;
  interrupted: boolean;
  replacement: string;
  note: string;
};

type LifeOSStore = {
  version: 1;
  days: Record<string, DailyEntry>;
  episodes: Episode[];
};

type WeeklyProgress = {
  daysLogged: number;
  reviewedDays: number;
  focusMinutes: number;
  focusResults: { achieved: number; partial: number; missed: number };
  codeMinutes: number;
  filesUnderstood: number;
  personalContent: number;
  hustliqContent: number;
  collegeMinutes: number;
  japaneseMinutes: number;
  meaningfulConversations: number;
  adventures: number;
  rehabSessions: number;
  gymSessions: number;
  averageConsumerScrollMinutes: number;
  impulsesLogged: number;
  impulsesInterrupted: number;
  averageCodeConfidence: number;
  emotions: Record<EmotionMetric, number>;
  balance: Record<BalanceKey, number>;
};

type LifeOSProgress = {
  throughDate: string;
  today: {
    logged: boolean;
    priorities: { completed: number; planned: number; percent: number };
    morning: { completed: number; total: number; percent: number };
    focusOutcome: Outcome;
    focusMinutes: number;
  };
  week: WeeklyProgress & { targets: Record<string, { achieved: number; target: number; percent: number }> };
};

type LifeOSResponse = {
  store: LifeOSStore;
  revision: number;
  initialized: boolean;
  progress: LifeOSProgress;
};

type SyncState = "loading" | "saved" | "saving" | "offline" | "conflict";

const STORAGE_KEY = "mizan-life-os-dashboard-v1";
const WORKSPACE_KEY_STORAGE = "mizan-life-os-workspace-key-v1";

function getWorkspaceKey() {
  const existing = window.localStorage.getItem(WORKSPACE_KEY_STORAGE);
  if (existing && /^[A-Za-z0-9_-]{43,128}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  window.localStorage.setItem(WORKSPACE_KEY_STORAGE, key);
  return key;
}

const DAY_TYPES: Array<{ id: DayType; label: string; purpose: string; note: string; defaults: Partial<DailyEntry> }> = [
  { id: "home", label: "Home Deep Work", purpose: "Build HustlIQ and make meaningful progress.", note: "Protect two focused blocks. Keep the rest light.", defaults: { growth: "Code reading · 25 min", fun: "Choose one intentional way to unwind" } },
  { id: "content", label: "Content", purpose: "Batch content without constantly switching roles.", note: "Script → film → edit → schedule, plus one HustlIQ block.", defaults: { growth: "One important HustlIQ block", fun: "Intentional recreation after the batch" } },
  { id: "short-college", label: "Short College", purpose: "Handle college and protect a smaller HustlIQ win.", note: "Four hours of transport lowers available capacity.", defaults: { growth: "Commute: Japanese or code reading", fun: "Light recovery" } },
  { id: "long-college", label: "Long College", purpose: "Maintain the essentials on a very long day.", note: "Today is a maintenance day. Low HustlIQ output is expected.", defaults: { growth: "Optional listening on the commute", fun: "Food, recovery, and sleep" } },
  { id: "social", label: "Social / Adventure", purpose: "Rebuild novelty, confidence, connection, and enjoyment.", note: "This counts as life progress, not lost productivity.", defaults: { growth: "Be present and try something new", fun: "The day itself is intentional fun" } },
  { id: "recovery", label: "Recovery", purpose: "Protect rehabilitation, calm, and one small useful action.", note: "Professional rehabilitation instructions override Life OS.", defaults: { growth: "One gentle growth action", fun: "Rest without guilt" } },
];

const MORNING_ITEMS = [
  "Get out of bed and leave the phone outside the bathroom",
  "Wash, drink water, and eat breakfast",
  "Get daylight and safe light movement",
  "Talk to family if available",
  "Name today’s most important HustlIQ result",
  "Prepare the workspace and begin intentional work",
];

const EMOTIONS: Array<{ key: EmotionMetric; label: string }> = [
  { key: "anxiety", label: "Anxiety" },
  { key: "numbness", label: "Numbness" },
  { key: "motivation", label: "Motivation" },
  { key: "focus", label: "Focus" },
  { key: "confidence", label: "Confidence" },
  { key: "loneliness", label: "Loneliness" },
  { key: "mood", label: "Mood" },
];

const BALANCE_AREAS: Array<{ key: BalanceKey; label: string }> = [
  { key: "hustliq", label: "HustlIQ" },
  { key: "college", label: "College" },
  { key: "mental", label: "Mental recovery" },
  { key: "physical", label: "Physical recovery" },
  { key: "content", label: "Content" },
  { key: "relationships", label: "Relationships" },
  { key: "learning", label: "Learning" },
  { key: "recreation", label: "Recreation" },
];

function cairoDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function emptyDay(): DailyEntry {
  return {
    dayType: "home",
    mustWin: "",
    supports: ["", ""],
    growth: "Code reading · 25 min",
    fun: "Choose one intentional way to unwind",
    done: {},
    morning: {},
    scrollMinutes: 0,
    focusResult: "",
    focusMinutes: 90,
    focusOutcome: "",
    codeMinutes: 0,
    codeFile: "",
    codeResponsibility: "",
    codeInput: "",
    codeOutput: "",
    codeDependencies: "",
    codeGap: "",
    codeExplanation: "",
    codeConfidence: 3,
    filesUnderstood: 0,
    aiUnderstanding: "mostly",
    aiChange: "",
    contentPersonal: 0,
    contentHustliq: 0,
    collegeMinutes: 0,
    japaneseMinutes: 0,
    meaningfulConversation: false,
    socialAdventure: "na",
    rehab: "na",
    gym: "na",
    movement: "medium",
    impulseOutcome: "",
    emotions: { anxiety: 5, numbness: 5, motivation: 5, focus: 5, confidence: 5, loneliness: 5, mood: 5 },
    reviewWorked: "",
    reviewFailed: "",
    reviewDistraction: "",
    reviewChange: "",
    balance: { hustliq: 4, college: 2, mental: 3, physical: 3, content: 2, relationships: 2, learning: 2, recreation: 2 },
    commuteMode: "",
    funChoices: [],
  };
}

function clampNumber(value: number, max = 600) {
  return Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
}

function Field({ label, value, onChange, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean }) {
  return (
    <label className="los-field">
      <span>{label}</span>
      {multiline ? <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}/> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}/>} 
    </label>
  );
}

function NumberField({ label, value, onChange, suffix, max = 600 }: { label: string; value: number; onChange: (value: number) => void; suffix?: string; max?: number }) {
  return (
    <label className="los-number-field">
      <span>{label}</span>
      <span><input type="number" min="0" max={max} value={value} onChange={(event) => onChange(clampNumber(Number(event.target.value), max))}/>{suffix && <small>{suffix}</small>}</span>
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return <div className="los-segmented" role="group" aria-label={label}>{options.map((option) => <button key={option.value} type="button" className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

function Stat({ value, label, detail }: { value: string | number; label: string; detail?: string }) {
  return <div className="los-stat"><strong>{value}</strong><span>{label}</span>{detail && <small>{detail}</small>}</div>;
}

export default function LifeOSWorkspace({ apiBase }: { apiBase: string }) {
  const dateKey = cairoDateKey();
  const [section, setSection] = useState<Section>("today");
  const [store, setStore] = useState<LifeOSStore>({ version: 1, days: {}, episodes: [] });
  const [hydrated, setHydrated] = useState(false);
  const [serverProgress, setServerProgress] = useState<LifeOSProgress | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [syncError, setSyncError] = useState("");
  const [overwhelmed, setOverwhelmed] = useState(false);
  const [episodeOpen, setEpisodeOpen] = useState(false);
  const [movementReminder, setMovementReminder] = useState(false);
  const [episode, setEpisode] = useState<Omit<Episode, "id" | "dateKey">>({ time: new Date().toTimeString().slice(0, 5), location: "", before: "", trigger: "", emotion: "unknown", intensity: 5, interrupted: true, replacement: "", note: "" });

  const revisionRef = useRef(0);
  const readyToSyncRef = useRef(false);
  const lastSavedJsonRef = useRef("");
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const requestLifeOS = useCallback(async (method: "GET" | "PUT", body?: unknown) => {
    const response = await fetch(`${apiBase}/api/life-os${method === "GET" ? `?through=${encodeURIComponent(dateKey)}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json", "x-mizan-workspace-key": getWorkspaceKey() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || (response.status === 404 ? "Life OS storage is not deployed on this server yet." : "Could not save Life OS to the backend."));
      Object.assign(error, { status: response.status });
      throw error;
    }
    return result as LifeOSResponse;
  }, [apiBase, dateKey]);

  useEffect(() => {
    let cancelled = false;
    let cached: LifeOSStore | null = null;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as LifeOSStore;
        if (parsed?.version === 1 && parsed.days && Array.isArray(parsed.episodes)) {
          cached = parsed;
          setStore(parsed);
        }
      }
    } catch {
      // A damaged offline cache should never block the backend-backed dashboard.
    }
    setHydrated(true);

    void (async () => {
      setSyncState("loading");
      setSyncError("");
      try {
        let result = await requestLifeOS("GET");
        if (cancelled) return;
        revisionRef.current = result.revision;
        if (!result.initialized && cached) {
          result = await requestLifeOS("PUT", { revision: 0, store: cached, through: dateKey });
          if (cancelled) return;
        } else if (result.initialized) {
          setStore(result.store);
        }
        revisionRef.current = result.revision;
        lastSavedJsonRef.current = JSON.stringify(result.store);
        setServerProgress(result.progress);
        readyToSyncRef.current = true;
        setSyncState("saved");
      } catch (error) {
        if (cancelled) return;
        readyToSyncRef.current = true;
        setSyncState((error as Error & { status?: number }).status === 409 ? "conflict" : "offline");
        setSyncError(error instanceof Error ? error.message : "Backend unavailable. Changes remain in the offline cache.");
      }
    })();
    return () => { cancelled = true; };
  }, [dateKey, requestLifeOS]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    const serialized = JSON.stringify(store);
    if (!readyToSyncRef.current || serialized === lastSavedJsonRef.current) return;
    const timer = window.setTimeout(() => {
      setSyncState("saving");
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        try {
          const result = await requestLifeOS("PUT", { revision: revisionRef.current, store, through: dateKey });
          revisionRef.current = result.revision;
          lastSavedJsonRef.current = serialized;
          setServerProgress(result.progress);
          setSyncError("");
          setSyncState("saved");
        } catch (error) {
          const status = (error as Error & { status?: number }).status;
          if (status === 409) readyToSyncRef.current = false;
          setSyncState(status === 409 ? "conflict" : "offline");
          setSyncError(error instanceof Error ? error.message : "Backend unavailable. Changes remain in the offline cache.");
        }
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [store, hydrated, dateKey, requestLifeOS]);

  useEffect(() => {
    if (movementReminder) return;
    const timer = window.setTimeout(() => setMovementReminder(true), 50 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [movementReminder]);

  const day = store.days[dateKey] ?? emptyDay();
  const dayType = DAY_TYPES.find((item) => item.id === day.dayType) ?? DAY_TYPES[0];

  function updateDay(patch: Partial<DailyEntry>) {
    setStore((current) => ({ ...current, days: { ...current.days, [dateKey]: { ...(current.days[dateKey] ?? emptyDay()), ...patch } } }));
  }

  function chooseDayType(next: DayType) {
    const template = DAY_TYPES.find((item) => item.id === next)!;
    updateDay({ dayType: next, ...(day.growth ? {} : { growth: template.defaults.growth ?? "" }), ...(day.fun ? {} : { fun: template.defaults.fun ?? "" }) });
  }

  function toggleDone(id: string) {
    updateDay({ done: { ...day.done, [id]: !day.done[id] } });
  }

  function saveEpisode(event: React.FormEvent) {
    event.preventDefault();
    const next: Episode = { ...episode, id: crypto.randomUUID(), dateKey };
    setStore((current) => ({ ...current, episodes: [next, ...current.episodes].slice(0, 250) }));
    setEpisodeOpen(false);
    setEpisode({ time: new Date().toTimeString().slice(0, 5), location: "", before: "", trigger: "", emotion: "unknown", intensity: 5, interrupted: true, replacement: "", note: "" });
  }

  const weekDays = useMemo(() => {
    const result: DailyEntry[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const entry = store.days[cairoDateKey(date)];
      if (entry) result.push(entry);
    }
    return result;
  }, [store.days]);

  const weekKeys = useMemo(() => Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return cairoDateKey(date);
  }), []);

  const localWeekly = useMemo(() => ({
    focusMinutes: weekDays.reduce((sum, item) => sum + (item.focusOutcome ? item.focusMinutes : 0), 0),
    codeMinutes: weekDays.reduce((sum, item) => sum + item.codeMinutes, 0),
    files: weekDays.reduce((sum, item) => sum + item.filesUnderstood, 0),
    personalContent: weekDays.reduce((sum, item) => sum + item.contentPersonal, 0),
    hustliqContent: weekDays.reduce((sum, item) => sum + item.contentHustliq, 0),
    collegeMinutes: weekDays.reduce((sum, item) => sum + item.collegeMinutes, 0),
    japaneseMinutes: weekDays.reduce((sum, item) => sum + item.japaneseMinutes, 0),
    conversations: weekDays.filter((item) => item.meaningfulConversation).length,
    adventures: weekDays.filter((item) => item.socialAdventure === "yes").length,
    rehab: weekDays.filter((item) => item.rehab === "yes").length,
    gym: weekDays.filter((item) => item.gym === "yes").length,
    avgScroll: weekDays.length ? Math.round(weekDays.reduce((sum, item) => sum + item.scrollMinutes, 0) / weekDays.length) : 0,
    interrupted: store.episodes.filter((item) => item.interrupted && weekKeys.includes(item.dateKey)).length,
    confidence: weekDays.length ? Math.round(weekDays.reduce((sum, item) => sum + item.codeConfidence, 0) / weekDays.length * 10) / 10 : 0,
    emotions: Object.fromEntries(EMOTIONS.map(({ key }) => [key, weekDays.length ? Math.round(weekDays.reduce((sum, item) => sum + item.emotions[key], 0) / weekDays.length * 10) / 10 : 0])) as Record<EmotionMetric, number>,
  }), [store.episodes, weekDays, weekKeys]);

  const weekly = serverProgress?.week ? {
    focusMinutes: serverProgress.week.focusMinutes,
    codeMinutes: serverProgress.week.codeMinutes,
    files: serverProgress.week.filesUnderstood,
    personalContent: serverProgress.week.personalContent,
    hustliqContent: serverProgress.week.hustliqContent,
    collegeMinutes: serverProgress.week.collegeMinutes,
    japaneseMinutes: serverProgress.week.japaneseMinutes,
    conversations: serverProgress.week.meaningfulConversations,
    adventures: serverProgress.week.adventures,
    rehab: serverProgress.week.rehabSessions,
    gym: serverProgress.week.gymSessions,
    avgScroll: serverProgress.week.averageConsumerScrollMinutes,
    interrupted: serverProgress.week.impulsesInterrupted,
    confidence: serverProgress.week.averageCodeConfidence,
    emotions: serverProgress.week.emotions,
  } : localWeekly;

  const morningComplete = MORNING_ITEMS.filter((item) => day.morning[item]).length;
  const priorities = [day.mustWin, ...day.supports].filter(Boolean);
  const completedPriorities = ["must", "support-0", "support-1"].filter((id) => day.done[id]).length;

  return (
    <div className="life-os-workspace">
      <header className="los-heading">
        <div>
          <p className="eyebrow">Private operating system</p>
          <h1>Life OS</h1>
          <p>Notice drift, understand it, and return to what matters without turning life into another job.</p>
        </div>
        <div className="los-heading-side">
          <div className="los-heading-status"><span>Current mission</span><strong>Launch HustlIQ</strong><small>First 15 users · $200 gross profit</small></div>
          <div className={`los-sync-status ${syncState}`} role="status" title={syncError || undefined}>
            <span aria-hidden="true"/>
            {syncState === "loading" ? "Connecting to backend…" : syncState === "saving" ? "Saving to backend…" : syncState === "saved" ? "Saved to backend" : syncState === "conflict" ? "Sync conflict · local copy kept" : "Offline · local copy kept"}
          </div>
        </div>
      </header>

      <nav className="los-tabs" aria-label="Life OS sections">
        {(["today", "mission", "focus", "life", "review"] as Section[]).map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{item === "life" ? "Life areas" : item[0].toUpperCase() + item.slice(1)}</button>)}
      </nav>

      {section === "today" && (
        <div className="los-section los-today">
          <section className="los-day-type-panel">
            <div className="los-section-title"><div><p className="eyebrow">Start here</p><h2>What kind of day is today?</h2></div><span>{completedPriorities}/{Math.max(priorities.length, 1)} priorities moved</span></div>
            <div className="los-day-types">{DAY_TYPES.map((item) => <button key={item.id} className={day.dayType === item.id ? "active" : ""} onClick={() => chooseDayType(item.id)}><strong>{item.label}</strong><span>{item.purpose}</span></button>)}</div>
            <div className={`los-day-note ${day.dayType === "long-college" || day.dayType === "recovery" ? "calm" : ""}`}><strong>{dayType.purpose}</strong><span>{dayType.note}</span></div>
          </section>

          <div className="los-today-grid">
            <section className="los-panel los-priorities">
              <div className="los-section-title"><div><p className="eyebrow">Today’s shape</p><h2>One win. Two supports.</h2></div><small>Maximum 3 must-dos</small></div>
              <div className="los-priority primary"><button aria-label="Mark must win complete" className={day.done.must ? "checked" : ""} onClick={() => toggleDone("must")}>{day.done.must ? "✓" : ""}</button><Field label="1 must win" value={day.mustWin} onChange={(mustWin) => updateDay({ mustWin })} placeholder="The result that would make today count"/></div>
              {day.supports.map((value, index) => <div className="los-priority" key={index}><button aria-label={`Mark support ${index + 1} complete`} className={day.done[`support-${index}`] ? "checked" : ""} onClick={() => toggleDone(`support-${index}`)}>{day.done[`support-${index}`] ? "✓" : ""}</button><Field label={`Support ${index + 1}`} value={value} onChange={(next) => { const supports = [...day.supports] as [string, string]; supports[index] = next; updateDay({ supports }); }} placeholder={index === 0 ? "A responsibility or recovery action" : "Leave blank if it does not earn a place"}/></div>)}
              <div className="los-secondary-grid"><Field label="Small growth" value={day.growth} onChange={(growth) => updateDay({ growth })}/><Field label="Intentional fun" value={day.fun} onChange={(fun) => updateDay({ fun })}/></div>
            </section>

            <aside className="los-panel los-next-panel">
              <p className="eyebrow">Do next</p>
              <h2>{day.mustWin || "Name the result that would make today count."}</h2>
              <p>{day.mustWin ? "Make the first visible move. The rest of the system can wait." : "A concrete result is easier to start than a broad category like “work on HustlIQ.”"}</p>
              <button className="los-primary" onClick={() => document.getElementById("los-focus-block")?.scrollIntoView({ behavior: "smooth", block: "center" })}>{day.mustWin ? "Define the focus block" : "Set the must win"}</button>
              <button className="los-overwhelmed-button" onClick={() => setOverwhelmed(true)}>I’m overwhelmed</button>
            </aside>
          </div>

          <section className="los-panel" id="los-focus-block">
            <div className="los-section-title"><div><p className="eyebrow">HustlIQ focus</p><h2>Make the block measurable.</h2></div><Segmented label="Focus block length" value={String(day.focusMinutes) as "45" | "90"} options={[{ value: "45", label: "45 min start" }, { value: "90", label: "90 min deep" }]} onChange={(value) => updateDay({ focusMinutes: Number(value) })}/></div>
            <div className="los-focus-grid"><Field label="What result will make this block successful?" value={day.focusResult} onChange={(focusResult) => updateDay({ focusResult })} placeholder="Example: test the main workflow and fix the top three bugs"/><div><span className="los-label">Did you achieve it?</span><Segmented label="Focus outcome" value={day.focusOutcome} options={[{ value: "yes", label: "Yes" }, { value: "partial", label: "Partly" }, { value: "no", label: "No" }, { value: "", label: "Not yet" }]} onChange={(focusOutcome) => updateDay({ focusOutcome })}/></div></div>
          </section>

          <section className="los-glance" aria-label="Today at a glance">
            <Stat value={`${morningComplete}/${MORNING_ITEMS.length}`} label="Morning reset" detail="Passive feeds wait for the first hour"/>
            <Stat value={`${day.scrollMinutes}m`} label="Consumer scrolling" detail="Work and useful tools do not count"/>
            <Stat value={`${day.codeMinutes}m`} label="Code reading" detail="Target 20–30 minutes"/>
            <Stat value={day.meaningfulConversation ? "Yes" : "Not yet"} label="Real conversation" detail="Connection counts as progress"/>
          </section>

          <div className="los-details-grid">
            <details className="los-details"><summary><span><strong>Morning reset</strong><small>First 60 minutes: active start, not passive consumption</small></span><b>{morningComplete}/{MORNING_ITEMS.length}</b></summary><div className="los-check-list">{MORNING_ITEMS.map((item) => <label key={item}><input type="checkbox" checked={Boolean(day.morning[item])} onChange={() => updateDay({ morning: { ...day.morning, [item]: !day.morning[item] } })}/><span>{item}</span></label>)}</div><p className="los-allow-note">Messages, music, navigation, work, and intentional learning are allowed. The target is passive consumption, not technology.</p></details>
            <details className="los-details"><summary><span><strong>Small daily signals</strong><small>Log only what helps you notice drift</small></span><b>Open</b></summary><div className="los-compact-grid"><NumberField label="Consumer scrolling" value={day.scrollMinutes} onChange={(scrollMinutes) => updateDay({ scrollMinutes })} suffix="min"/><NumberField label="Code reading" value={day.codeMinutes} onChange={(codeMinutes) => updateDay({ codeMinutes })} suffix="min"/><NumberField label="Japanese" value={day.japaneseMinutes} onChange={(japaneseMinutes) => updateDay({ japaneseMinutes })} suffix="min"/><label className="los-toggle"><input type="checkbox" checked={day.meaningfulConversation} onChange={(event) => updateDay({ meaningfulConversation: event.target.checked })}/><span><strong>Meaningful conversation</strong><small>About 30+ minutes when possible</small></span></label></div></details>
          </div>
        </div>
      )}

      {section === "mission" && (
        <div className="los-section">
          <section className="los-mission-hero"><p className="eyebrow">Current 4-month mission</p><h2>Launch HustlIQ, finish and test the core feature, reach the first 15 users, and cross $200 gross profit.</h2><p>Everything else supports the person capable of finishing this mission. It does not compete with it.</p></section>
          <div className="los-mission-grid">
            <section className="los-panel"><p className="eyebrow">Priority hierarchy</p><div className="los-tier core"><span>Tier 1</span><div><strong>HustlIQ</strong><strong>Mental recovery / focus</strong></div></div><div className="los-tier"><span>Tier 2</span><div><strong>College</strong><strong>Physical recovery</strong></div></div><div className="los-tier"><span>Tier 3</span><div><strong>Content creation</strong><strong>Social life</strong><strong>Japanese</strong></div></div><div className="los-tier recreation"><span>Recreation</span><p>Chess, Yu-Gi-Oh!, anime, F1, gaming, movies, and new experiences support life. They are not another productivity system.</p></div></section>
            <section className="los-panel"><p className="eyebrow">HustlIQ mission control</p><h2>Finish → test → launch → acquire</h2><ol className="los-milestones">{["Finish core feature", "Test internally", "Test with first user", "Fix important issues", "Launch", "Acquire first 5 users", "Acquire first 15 users", "Cross $200 gross profit"].map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item}</strong></li>)}</ol></section>
          </div>
          <details className="los-details"><summary><span><strong>Supporting goals</strong><small>Visible when planning the month, quiet during the day</small></span><b>14</b></summary><ul className="los-supporting-goals">{["Mental clarity and concentration", "Less compulsive scrolling and high-stimulation habits", "Confidence and emotional engagement", "Less loneliness and a better social life", "Pass college", "Recover properly from injury", "Exercise within recovery limits", "Build content consistently", "Learn Japanese for four months", "Rebuild hobbies, curiosity, novelty, and enjoyment", "Understand and read the HustlIQ codebase", "Use AI without surrendering technical ownership", "Protect relationships", "Create a life worth being present for"].map((item) => <li key={item}>{item}</li>)}</ul></details>
        </div>
      )}

      {section === "focus" && (
        <div className="los-section">
          <div className="los-section-heading"><p className="eyebrow">Attention, not screen time</p><h2>Protect the ability to choose what happens next.</h2><p>Creator use is intentional. Consumer use is what gets measured and reduced.</p></div>
          <div className="los-focus-columns">
            <section className="los-panel"><p className="eyebrow">Social media modes</p><div className="los-mode-comparison"><div><strong>Creator mode</strong><p>Publish, answer relevant comments and messages, research something specific, review analytics.</p></div><div><strong>Consumer mode</strong><p>Endless feeds, short videos, explore pages, recommendation hopping, and automatic reopening.</p></div></div><NumberField label="Consumer scrolling today" value={day.scrollMinutes} onChange={(scrollMinutes) => updateDay({ scrollMinutes })} suffix="minutes"/></section>
            <section className="los-panel los-interrupt"><p className="eyebrow">Impulse control</p><h2>Notice → phone down → stand → move → wait 10 minutes.</h2><p>Close the trigger. Do not search for another. Put the phone away from your body and do something incompatible with the sequence.</p><div className="los-safe-actions"><span>Sit near family</span><span>Shower</span><span>Pray</span><span>Get food or water</span><span>Go outside</span><span>Call someone</span></div><button className="los-primary" onClick={() => setEpisodeOpen(true)}>Log an episode · under 30 sec</button><small>{store.episodes.filter((item) => item.dateKey === dateKey).length} logged today · patterns, not shame</small></section>
          </div>

          <section className="los-panel"><div className="los-section-title"><div><p className="eyebrow">Code understanding</p><h2>Read the code, not just the output.</h2></div><span>20–30 min target</span></div><div className="los-code-grid"><NumberField label="Minutes today" value={day.codeMinutes} onChange={(codeMinutes) => updateDay({ codeMinutes })} suffix="min" max={180}/><NumberField label="Files understood" value={day.filesUnderstood} onChange={(filesUnderstood) => updateDay({ filesUnderstood })} max={30}/><label className="los-range"><span>Understanding confidence · {day.codeConfidence}/5</span><input type="range" min="1" max="5" value={day.codeConfidence} onChange={(event) => updateDay({ codeConfidence: Number(event.target.value) })}/></label></div><div className="los-form-grid"><Field label="What file am I reading?" value={day.codeFile} onChange={(codeFile) => updateDay({ codeFile })}/><Field label="What is it responsible for?" value={day.codeResponsibility} onChange={(codeResponsibility) => updateDay({ codeResponsibility })}/><Field label="What enters this code?" value={day.codeInput} onChange={(codeInput) => updateDay({ codeInput })}/><Field label="What does it return or change?" value={day.codeOutput} onChange={(codeOutput) => updateDay({ codeOutput })}/><Field label="What does it depend on?" value={day.codeDependencies} onChange={(codeDependencies) => updateDay({ codeDependencies })}/><Field label="What is still unclear?" value={day.codeGap} onChange={(codeGap) => updateDay({ codeGap })}/></div><Field label="Explain it in my own words" value={day.codeExplanation} onChange={(codeExplanation) => updateDay({ codeExplanation })} multiline/></section>

          <section className="los-panel"><div className="los-section-title"><div><p className="eyebrow">AI coding safety</p><h2>Keep the speed. Keep ownership.</h2></div></div><div className="los-ai-grid"><div><span className="los-label">Before a major AI change, do I understand the existing flow?</span><Segmented label="Existing flow understanding" value={day.aiUnderstanding} options={[{ value: "yes", label: "Yes" }, { value: "mostly", label: "Mostly" }, { value: "no", label: "No" }]} onChange={(aiUnderstanding) => updateDay({ aiUnderstanding })}/>{day.aiUnderstanding === "no" && <p className="los-inline-warning">Spend 5–10 minutes reading the related files first.</p>}</div><Field label="What did AI change?" value={day.aiChange} onChange={(aiChange) => updateDay({ aiChange })} placeholder="One or two sentences" multiline/></div><div className="los-check-strip"><span>Read changed files</span><span>Identify the important functions</span><span>Run and test the feature</span><span>Explain the change briefly</span></div><details className="los-inline-details"><summary>Weekly full-flow code review · 45–60 minutes</summary><p>Trace one feature from button → frontend component → API → middleware/controller → database → response → UI. Finish by answering: could I explain this flow to another developer?</p></details></section>
        </div>
      )}

      {section === "life" && (
        <div className="los-section">
          <div className="los-section-heading"><p className="eyebrow">Supporting systems</p><h2>Life areas stay available, not noisy.</h2><p>Open an area when you are planning it. Today only pulls in what matches the day type.</p></div>
          <div className="los-area-list">
            <details className="los-details" open><summary><span><strong>Body and recovery</strong><small>Rehabilitation instructions always win</small></span><b>Care</b></summary><div className="los-area-content"><p className="los-safety-note">Major adductor injury: do not automatically recommend running, football, lower-body training, or aggressive walking goals until medically cleared.</p><div className="los-form-grid"><div><span className="los-label">Rehabilitation · target about 3×/week</span><Segmented label="Rehabilitation" value={day.rehab} options={[{ value: "yes", label: "Done" }, { value: "no", label: "Not done" }, { value: "na", label: "Not planned" }]} onChange={(rehab) => updateDay({ rehab })}/></div><div><span className="los-label">Upper-body gym · target about 3×/week</span><Segmented label="Gym" value={day.gym} options={[{ value: "yes", label: "Done" }, { value: "no", label: "Not done" }, { value: "na", label: "Not planned" }]} onChange={(gym) => updateDay({ gym })}/></div></div><p>Every 45–60 minutes: change position or safely move for 2–5 minutes. Dismiss when deep concentration should continue.</p></div></details>
            <details className="los-details"><summary><span><strong>College and commute</strong><small>Pass first. Adjust study load to attendance.</small></span><b>~4h travel</b></summary><div className="los-area-content"><p>Short days protect one smaller HustlIQ block. Long days protect food, recovery, tomorrow's plan, and sleep.</p><div className="los-form-grid"><NumberField label="College study today" value={day.collegeMinutes} onChange={(collegeMinutes) => updateDay({ collegeMinutes })} suffix="min"/><div><span className="los-label">Choose one commute mode</span><div className="los-choice-actions">{["Japanese", "Code reading", "Podcast / learning", "Messages", "Music", "Rest", "Intentional video"].map((item) => <button key={item} type="button" className={`los-choice-btn${(day.commuteMode ?? "") === item ? " active" : ""}`} onClick={() => updateDay({ commuteMode: (day.commuteMode ?? "") === item ? "" : item })}>{item}</button>)}</div></div></div><p className="los-allow-note">Do not make all four travel hours productive. Even 30–60 useful minutes is successful.</p></div></details>
            <details className="los-details"><summary><span><strong>Content</strong><small>Batch roles; volume remains adjustable</small></span><b>7 + 4</b></summary><div className="los-area-content"><p>Personal target: 7 shorts/week. HustlIQ target: 4 shorts/week. Launch, mental health, college, and recovery outrank blindly reaching 11 videos.</p><div className="los-form-grid"><NumberField label="Personal videos published today" value={day.contentPersonal} onChange={(contentPersonal) => updateDay({ contentPersonal })} max={20}/><NumberField label="HustlIQ videos published today" value={day.contentHustliq} onChange={(contentHustliq) => updateDay({ contentHustliq })} max={20}/></div><div className="los-process"><span>Ideas</span><i>→</i><span>Scripted</span><i>→</i><span>Ready to film</span><i>→</i><span>Filmed</span><i>→</i><span>Editing</span><i>→</i><span>Published</span></div></div></details>
            <details className="los-details"><summary><span><strong>Japanese</strong><small>Four-month challenge with friends</small></span><b>20–30 min</b></summary><div className="los-area-content"><NumberField label="Japanese today" value={day.japaneseMinutes} onChange={(japaneseMinutes) => updateDay({ japaneseMinutes })} suffix="min"/><p>Use commute time when it fits. Japanese never takes HustlIQ's prime work hours.</p></div></details>
            <details className="los-details"><summary><span><strong>Social and adventure</strong><small>Connection and novelty are life progress</small></span><b>3 + 1</b></summary><div className="los-area-content"><label className="los-toggle"><input type="checkbox" checked={day.meaningfulConversation} onChange={(event) => updateDay({ meaningfulConversation: event.target.checked })}/><span><strong>Meaningful conversation today</strong><small>Friend, cousin, family, call, or in person · around 30+ minutes</small></span></label><div><span className="los-label">Social / adventure event</span><Segmented label="Social adventure" value={day.socialAdventure} options={[{ value: "yes", label: "Done" }, { value: "no", label: "Not done" }, { value: "na", label: "Not planned" }]} onChange={(socialAdventure) => updateDay({ socialAdventure })}/></div></div></details>
            <details className="los-details"><summary><span><strong>Intentional fun</strong><small>Enjoyment without automatic consumption</small></span><b>{(day.funChoices ?? []).length > 0 ? (day.funChoices ?? []).join(", ") : "No guilt"}</b></summary><div className="los-area-content"><p className="los-recreation-question">Am I choosing this because I want to enjoy it, or avoiding something I intended to start?</p><div className="los-choice-actions">{["Chess · ≤3 games or ~30 min", "Yu-Gi-Oh! · 2 × 45 min/week", "Anime · 1–2 selected episodes", "F1 / gaming · intentional", "Movies", "New experiences"].map((item) => { const chosen = (day.funChoices ?? []).includes(item); return <button key={item} type="button" className={`los-choice-btn${chosen ? " active" : ""}`} onClick={() => { const current = day.funChoices ?? []; updateDay({ funChoices: chosen ? current.filter((f) => f !== item) : [...current, item] }); }}>{item}</button>; })}</div></div></details>
          </div>
        </div>
      )}

      {section === "review" && (
        <div className="los-section">
          <div className="los-section-heading"><p className="eyebrow">Trends, not streaks</p><h2>One event does not erase the rest of the week.</h2><p>Use the signal, adjust the system, and continue.</p></div>
          <section className="los-panel"><div className="los-section-title"><div><p className="eyebrow">Nightly scorecard</p><h2>Record the day once.</h2></div><small>Quick facts, not a second planning session</small></div><div className="los-scorecard-grid"><NumberField label="HustlIQ focused" value={day.focusOutcome ? day.focusMinutes : 0} onChange={(focusMinutes) => updateDay({ focusMinutes })} suffix="min"/><NumberField label="Code reading" value={day.codeMinutes} onChange={(codeMinutes) => updateDay({ codeMinutes })} suffix="min"/><NumberField label="College study" value={day.collegeMinutes} onChange={(collegeMinutes) => updateDay({ collegeMinutes })} suffix="min"/><NumberField label="Consumer scrolling" value={day.scrollMinutes} onChange={(scrollMinutes) => updateDay({ scrollMinutes })} suffix="min"/><NumberField label="Japanese" value={day.japaneseMinutes} onChange={(japaneseMinutes) => updateDay({ japaneseMinutes })} suffix="min"/><div><span className="los-label">Impulse interruption</span><Segmented label="Impulse interruption result" value={day.impulseOutcome} options={[{ value: "yes", label: "Yes" }, { value: "partial", label: "Partial" }, { value: "no", label: "No" }, { value: "", label: "N/A" }]} onChange={(impulseOutcome) => updateDay({ impulseOutcome })}/></div></div><div className="los-section-title los-emotion-heading"><div><p className="eyebrow">Mind</p><h2>How was the day?</h2></div><small>Seven signals, once nightly</small></div><div className="los-emotions">{EMOTIONS.map(({ key, label }) => <label key={key}><span>{label}</span><strong>{day.emotions[key]}/10</strong><input type="range" min="0" max="10" value={day.emotions[key]} onChange={(event) => updateDay({ emotions: { ...day.emotions, [key]: Number(event.target.value) } })}/></label>)}</div><div className="los-form-grid los-review-fields"><Field label="What worked?" value={day.reviewWorked} onChange={(reviewWorked) => updateDay({ reviewWorked })} multiline/><Field label="What repeatedly failed?" value={day.reviewFailed} onChange={(reviewFailed) => updateDay({ reviewFailed })} multiline/><Field label="What caused the most distraction?" value={day.reviewDistraction} onChange={(reviewDistraction) => updateDay({ reviewDistraction })} multiline/><Field label="What should change next?" value={day.reviewChange} onChange={(reviewChange) => updateDay({ reviewChange })} multiline/></div></section>
          <section className="los-panel"><div className="los-section-title"><div><p className="eyebrow">Life balance</p><h2>Where did attention actually go?</h2></div><small>0 = absent · 5 = dominant</small></div><p className="los-balance-intro">Set these from your own judgment. Life OS does not pretend unlike activities share one objective unit, and it does not expect equal slices. HustlIQ should currently lead without erasing relationships, recovery, or recreation.</p><div className="los-balance-grid">{BALANCE_AREAS.map(({ key, label }) => { const value = day.balance?.[key] ?? 0; return <label key={key}><span><strong>{label}</strong><b>{value}/5</b></span><span className="los-balance-track"><i style={{ width: `${value * 20}%` }}/></span><input aria-label={`${label} attention`} type="range" min="0" max="5" value={value} onChange={(event) => updateDay({ balance: { ...(day.balance ?? emptyDay().balance), [key]: Number(event.target.value) } })}/></label>; })}</div></section>
          <section className="los-panel"><div className="los-section-title"><div><p className="eyebrow">Last seven logged days</p><h2>Weekly review</h2></div><small>{serverProgress?.week.daysLogged ?? weekDays.length} days with data · {serverProgress ? "calculated by backend" : "offline estimate"}</small></div><div className="los-week-grid"><Stat value={`${Math.round(weekly.focusMinutes / 60 * 10) / 10}h`} label="HustlIQ focus"/><Stat value={`${weekly.codeMinutes}m`} label="Code reading" detail={`${weekly.files} files · ${weekly.confidence}/5 confidence`}/><Stat value={`${weekly.personalContent} / ${weekly.hustliqContent}`} label="Personal / HustlIQ videos"/><Stat value={`${Math.round(weekly.collegeMinutes / 60 * 10) / 10}h`} label="College study"/><Stat value={`${weekly.avgScroll}m`} label="Average consumer scrolling"/><Stat value={weekly.interrupted} label="Interrupted impulses"/><Stat value={`${weekly.rehab} / ${weekly.gym}`} label="Rehab / gym sessions"/><Stat value={`${weekly.japaneseMinutes}m`} label="Japanese"/><Stat value={`${weekly.conversations} / ${weekly.adventures}`} label="Conversations / adventures"/></div><div className="los-mental-averages">{EMOTIONS.map(({ key, label }) => <span key={key}><b>{weekly.emotions[key]}</b><small>{label}</small></span>)}</div></section>
        </div>
      )}

      {movementReminder && <aside className="los-movement-reminder" role="status"><div><strong>Change position or safely move for 2–5 minutes.</strong><span>Stand if comfortable, get water, change room, look outside, or use approved rehabilitation movement.</span></div><button onClick={() => setMovementReminder(false)}>Dismiss for focus</button></aside>}

      {overwhelmed && <div className="los-modal-layer" role="presentation"><button className="los-modal-backdrop" aria-label="Close overwhelm reset" onClick={() => setOverwhelmed(false)}/><section className="los-reset" role="dialog" aria-modal="true" aria-labelledby="los-reset-title"><p className="eyebrow">Reduce the day</p><h2 id="los-reset-title">You only need one next move.</h2><ol><li><span>1</span><strong>Put the phone down.</strong></li><li><span>2</span><strong>Take two minutes.</strong></li><li><span>3</span><div><strong>Choose one ten-minute start:</strong><div className="los-reset-options">{["HustlIQ", "College", "Clean environment", "Rehab", "Call or talk to someone"].map((item) => <button key={item} onClick={() => { updateDay({ mustWin: `${item} · 10 minute start` }); setOverwhelmed(false); }}>{item}</button>)}</div></div></li></ol><blockquote>You do not need enough motivation to finish. You only need enough to begin.</blockquote><button className="los-text-button" onClick={() => setOverwhelmed(false)}>Close</button></section></div>}

      {episodeOpen && <div className="los-modal-layer" role="presentation"><button className="los-modal-backdrop" aria-label="Close episode logger" onClick={() => setEpisodeOpen(false)}/><form className="los-episode-dialog" role="dialog" aria-modal="true" aria-labelledby="episode-title" onSubmit={saveEpisode}><div className="los-dialog-head"><div><p className="eyebrow">Pattern, not shame</p><h2 id="episode-title">What started the sequence?</h2></div><button type="button" onClick={() => setEpisodeOpen(false)} aria-label="Close">×</button></div><div className="los-form-grid"><label className="los-field"><span>Time</span><input type="time" value={episode.time} onChange={(event) => setEpisode({ ...episode, time: event.target.value })}/></label><Field label="Location" value={episode.location} onChange={(location) => setEpisode({ ...episode, location })}/><Field label="What was I doing 10 minutes before?" value={episode.before} onChange={(before) => setEpisode({ ...episode, before })}/><Field label="First trigger" value={episode.trigger} onChange={(trigger) => setEpisode({ ...episode, trigger })}/><label className="los-field"><span>Emotional state</span><select value={episode.emotion} onChange={(event) => setEpisode({ ...episode, emotion: event.target.value })}>{["anxious", "lonely", "overwhelmed", "bored", "tired", "stressed", "avoiding something", "unknown", "other"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="los-range"><span>Urge intensity · {episode.intensity}/10</span><input type="range" min="0" max="10" value={episode.intensity} onChange={(event) => setEpisode({ ...episode, intensity: Number(event.target.value) })}/></label><label className="los-toggle"><input type="checkbox" checked={episode.interrupted} onChange={(event) => setEpisode({ ...episode, interrupted: event.target.checked })}/><span><strong>I interrupted the sequence</strong><small>No judgment if the answer is no.</small></span></label><Field label="What did I do instead?" value={episode.replacement} onChange={(replacement) => setEpisode({ ...episode, replacement })}/></div><Field label="Optional note" value={episode.note} onChange={(note) => setEpisode({ ...episode, note })} multiline/><div className="los-dialog-actions"><button type="button" onClick={() => setEpisodeOpen(false)}>Cancel</button><button className="los-primary" type="submit">Save privately</button></div></form></div>}
    </div>
  );
}
