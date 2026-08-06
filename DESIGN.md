# Design System — Mizan

## Product Context
- **What this is:** A private, AI-assisted life operating system that turns faith, health, ambition, college, relationships, and personal growth into one approved daily plan.
- **Who it is for:** Initially one ambitious engineering student and founder; the structure can later support startup founders and other serious goal-seekers.
- **Space:** Personal performance, habit tracking, planning, and reflective coaching.
- **Project type:** Responsive dashboard web app, primarily used on laptop with a complete phone experience.
- **Memorable idea:** It understands the whole person, then makes the next right action obvious.

## Aesthetic Direction
- **Direction:** Disciplined warmth.
- **Decoration:** Intentional and restrained. Fine rules, small status marks, and selective color establish rhythm. Decoration never competes with the next action.
- **Mood:** Serious, spiritually grounded, calm under pressure, and visibly ambitious. The product should feel like a trusted private room that creates momentum, not a passive report.
- **Deliberate departures:** A warm paper-like canvas instead of a dark “grind” dashboard; editorial serif typography only for purpose and long-term ambition; prayer times form the visible spine of the day.
- **Energy layer:** Momentum orange is reserved for the next move, streaks, active focus, and earned progress. It must never color prayer, recovery, or reflective coaching.

## Typography
- **Display/Purpose:** Instrument Serif, 400. Used sparingly for the biggest goal, major progress numbers, and reflective statements.
- **Body/UI:** Geist Sans, 400–700. Direct, compact, and clear at dashboard density.
- **Data:** Geist Mono, 500–600 with tabular numerals.
- **Scale:** 12, 13, 14, 16, 18, 22, 28, 38, and 56px. Mobile display size is capped at 40px.

## Color
- **Approach:** Restrained neutrals with semantic life-area colors. Color communicates category and state rather than decoration.
- **Canvas:** `#F3F2ED`
- **Surface:** `#FFFEFA`
- **Ink:** `#18201C`
- **Muted ink:** `#677069`
- **Hairline:** `#DADDD5`
- **Primary / faith / completion:** `#1F5B49`
- **Momentum:** `#C8782A`
- **Health:** `#3E7C72`
- **Business:** `#A96225`
- **College:** `#486B8A`
- **Mind:** `#7B6752`
- **Family/social:** `#8B5C66`
- **Warning:** `#B97822`
- **Error:** `#AC4943`
- **Dark mode:** Deep green-black canvas and warm ivory text; semantic colors reduce saturation to preserve hierarchy.

## Spacing
- **Base unit:** 4px.
- **Density:** Comfortable at the page level, compact inside tasks and metrics.
- **Scale:** 4, 8, 12, 16, 20, 24, 32, 40, 48, and 64px.

## Layout
- **Approach:** Grid-disciplined dashboard with one editorial moment for the Biggest Goal.
- **Desktop:** 248px persistent sidebar; main content uses a 12-column grid with a maximum width of 1600px.
- **Tablet:** Compact rail and two-column content.
- **Mobile:** Bottom navigation, single-column timeline, and fixed quick-action access.
- **Radius:** 6px controls, 10px task rows, 16px major surfaces, 999px status pills. Cards use borders and tonal contrast instead of default shadows.

## Motion
- **Approach:** Context-sensitive and functional.
- **Prayer/faith:** Soft color and quiet confirmation.
- **Work records and streaks:** Fast lift, count-up, and a crisp success mark. The current mission may use one warm focus surface and one short entrance animation.
- **Recovery:** Slower, calm transitions.
- **Durations:** 120ms micro, 220ms short, 360ms medium. Respect `prefers-reduced-motion`.

## UX Rules
- Today always answers: Where am I, what matters today, and what do I do next?
- The AI recommends and explains; the user approves every plan.
- The default day contains 2–3 serious missions. Supporting habits remain visibly secondary.
- Grinding Day protects four focused hours. Recovery Day protects rehabilitation, faith, rest, and one real work task. Vacation/Social Day contains no work.
- Unfinished work rolls forward at most four times before a reconsideration prompt; it is never silently deleted.
- Recreation can be intentional and life-giving. It is not scored as failure.
- Prayer, family, and college remain non-negotiable; public comparison and social feeds are out of scope.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-05 | Created the initial “disciplined warmth” system | High ambition needs clarity and energy, while recovery and faith need calm and dignity. |
| 2026-08-06 | Added Task History UI | Users need a way to review past actions seamlessly without cluttering the Today view. Past 30 days stored locally. |
| 2026-08-06 | Inline Task Adding | Reduces friction for capturing daily missions by removing the requirement to open the planner modal. |
| 2026-08-06 | Dynamic Goals & Tasks Counter | Goal progress is derived functionally based on elapsed time rather than manual input, providing an honest measure of trajectory. Users can track 'tasks done' against long-term goals. |
| 2026-08-06 | Custom Courage Reps | Enabled writing custom personality challenges to let the system adapt to the user's immediate context. |
| 2026-08-06 | Offline Planner Toggle | Added a checkbox in the planner to forcefully bypass the AI API call in favor of a local keyword-based parsing algorithm, ensuring reliability. |
| 2026-08-06 | Disabled Dark Mode | Temporarily paused dark mode to refine the light mode aesthetic and ensure panels read correctly. |
