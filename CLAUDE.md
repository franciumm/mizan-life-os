# Project Guidance

## Design System
Always read `DESIGN.md` before making visual or interface decisions. Fonts, colors, spacing, interaction states, and the product's emotional posture are defined there. Do not deviate without explicit user approval. In QA, flag any interface behavior or styling that conflicts with `DESIGN.md`.

## Recent Architecture & Features (Aug 2026)
- **Task History**: The app tracks completed/incomplete tasks past midnight into a rolling 30-day log.
- **Dynamic Goals**: `goalHorizons` has an object shape `{title: string, tasksDone: number}` and derives time-progress from `startDate` and `targetDate`. Be careful when iterating over goals to check their types.
- **Inline Editing & Custom Challenges**: Support for adding tasks inline and writing custom courage reps exist in the main dashboard view.
- **Offline Planner Mode**: The user can toggle an offline flag in the UI to skip the AI planning request and parse the plan locally.
- **Local Storage Schema**: Currently on `SCHEMA_VERSION = 3`. Keep backward compatibility via `migratePayload` when altering `PersistedPayload`.
