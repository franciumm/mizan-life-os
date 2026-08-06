import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Mizan life dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Mizan — Your life, in motion<\/title>/i);
  assert.match(html, /Assalamu alaykum, Mohamed/);
  assert.match(html, /Your life pulse/);
  assert.match(html, /Daily missions/);
  assert.match(html, /Prayer rhythm/);
  assert.match(html, /The biggest goal/);
  assert.match(html, /Plan tomorrow/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("keeps core interactions and responsive navigation in the product surface", async () => {
  const [dashboard, css, page, layout] = await Promise.all([
    readFile(new URL("../app/MizanDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /localStorage/);
  assert.match(dashboard, /Grinding Day active/);
  assert.match(dashboard, /Recovery Day active/);
  assert.match(dashboard, /Vacation Day active/);
  assert.match(dashboard, /Arrange tomorrow/);
  assert.match(dashboard, /I’m stuck/);
  assert.match(dashboard, /Personality grind/);
  // Phase 2: voice notes run locally via transformers.js (Whisper) instead of
  // shipping audio to a cloud SpeechRecognition backend. The dashboard wires
  // the lazy-loaded module + MediaRecorder; the whisper pipeline itself lives
  // in app/_voice/whisper.ts.
  assert.match(dashboard, /_voice\/whisper/);
  assert.match(dashboard, /Voice note/);
  assert.doesNotMatch(dashboard, /webkitSpeechRecognition|SpeechRecognition API/);
  // Phase 3: tomorrowTasks review surface. After approval the user can see,
  // remove, or scrap-and-replan tomorrow's tasks — no hidden state.
  assert.match(dashboard, /removeTomorrowTask/);
  // Phase 1 gap fix: "I'm stuck" routes through /api/coach with mode:"stuck"
  // and a tight max_tokens budget. A local heuristic may still fire on
  // failure, but it must be labeled as offline (stuckFallback), never served
  // silently as if it were AI.
  assert.match(dashboard, /mode: "stuck"/);
  assert.match(dashboard, /stuckFallback/);
  assert.match(dashboard, /Five-minute move \(offline\)/);
  assert.match(dashboard, /scrapTomorrowPlan/);
  assert.match(dashboard, /Tomorrow is set/);
  // Phase 3: prayer times use am/pm suffix, not 24-hour clock.
  assert.match(dashboard, /hour24 < 12 \? "am" : "pm"/);
  // Phase 3: rollover reconsideration. Tasks at rolled===4 surface a modal
  // with explicit keep / drop choices — no silent forever-roll.
  assert.match(dashboard, /rolloverReviewOpen/);
  assert.match(dashboard, /resetRollover/);
  assert.match(dashboard, /dropTask/);
  assert.match(dashboard, /rolled four times/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
  // Phase 4: DESIGN.md conformance. Momentum is #C8782A (not the old #df6b19),
  // no font sizes below 12px (the design scale minimum), and dark mode no
  // longer paints panels as light-on-light inversion.
  assert.match(css, /--momentum: #c8782a;/i);
  assert.doesNotMatch(css, /#df6b19/i);
  assert.doesNotMatch(css, /font-size: (8|9|10|11)px/);
  // Dark-mode panels use the dark surface tokens, not hard-coded light bg.
  assert.match(css, /\.big-goal-section, \.goal-hero, \.insight-summary, \.coach-context \{ color: var\(--ink\); background: var\(--surface\); \}/);
  // Phase 5: accessibility landmarks + live regions. Skip-link lets keyboard
  // users escape the sidebar; header carries role=banner; coach conversation
  // and Day power announce updates; prayer <time> carries datetime + label.
  assert.match(dashboard, /Skip to content/);
  assert.match(dashboard, /id="main-content"/);
  assert.match(dashboard, /role="banner"/);
  assert.match(dashboard, /aria-live="polite"/);
  assert.match(dashboard, /dateTime=\{prayerTimeIso\(prayer\.time\)\}/);
  assert.match(dashboard, /function prayerTimeIso/);
  assert.match(dashboard, /<footer className="app-footer"/);
  // Phase 6: data integrity. Payload is written with schemaVersion; loading
  // validates shape before React state is touched. Malformed payloads surface
  // a non-alarming notice and start fresh rather than silently swallowing.
  assert.match(dashboard, /const SCHEMA_VERSION = 1/);
  assert.match(dashboard, /function validatePayload/);
  assert.match(dashboard, /function isTask\(/);
  assert.match(dashboard, /setDataNotice\("Mizan could not read your saved workspace/);
  assert.match(dashboard, /data-notice/);
  // Phase 7: clean state. Seed tasks gone, storage key bumped to v2 so any
  // pre-existing payload with fabricated metrics is dropped, fabricated
  // sidebar/scores/records replaced with honest empty states.
  assert.match(dashboard, /const STORAGE_KEY = "mizan-life-os-v2"/);
  assert.match(dashboard, /const initialTasks: Task\[\] = \[/);
  assert.match(dashboard, /empty by design/);
  assert.match(dashboard, /const weeklyBars: number\[\] = \[\]/);
  assert.doesNotMatch(dashboard, /Lv\. 18|320 XP to Disciplined|12-day momentum/);
  assert.doesNotMatch(dashboard, /6h 42m|Doomscroll-free/);
  assert.match(dashboard, /status-strip-empty/);
  assert.match(dashboard, /chart-empty/);
  assert.match(dashboard, /record-grid-empty/);
  assert.match(page, /<MizanDashboard \/>/);
  assert.match(layout, /Instrument_Serif/);
});
