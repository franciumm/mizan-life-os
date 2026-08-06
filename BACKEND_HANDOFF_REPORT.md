# Mizan Life OS: Backend Handoff Report

## 1. Executive Summary
The Mizan Life OS currently operates as a heavy client-side React application (built on Vite/React). It manages complex relational data (Tasks, Cascading Goals, Daily Modes) entirely in the browser using `localStorage`. 

Because `localStorage` is fragile, limited in size, and tied to a single device/browser, the app requires a backend to ensure data reliability and cross-device access for a **single user** (personal-grade reliability). 

This document serves as a blueprint for a backend engineer to design a robust database and API layer that replaces the current `localStorage` implementation without breaking the frontend's highly reactive, offline-first feel.

---

## 2. Current Architecture Overview

Currently, the entire application state is stored in two primary JSON blobs in `localStorage`:
1. `mizan-life-os-v2`: Stores daily configurations, tasks, tomorrow's tasks, past task history, and check-in metrics.
2. `mizan-goals-v2`: Stores the multi-tiered goal horizons (1 month, 3 months, 1 year, 5 years) and the specific goals within them.

### The "Rollover" Algorithm (Client-Side Batch Job)
Every time the app mounts, it checks the current date (`cairoDateKey`). If the date has changed since the last load, a **Rollover** occurs:
- Unfinished tasks from yesterday have their `rolled` counter incremented.
- If a task rolls 4 times, it triggers a UI review.
- Yesterday's tasks are archived into a `pastTasks` array.
- "Tomorrow's plan" is promoted to "Today's plan".
*Backend Requirement:* This rollover logic should be moved to the backend, either evaluated lazily on the first request of a new day, or run via a daily cron job.

### Simulated Backend Features (AI Integrations)
The app currently makes calls to external LLMs (via OpenRouter integration in server API routes) for three key features:
1. `/api/arrange`: Takes an unstructured list of draft tasks and returns an optimized, chronologically ordered JSON array based on the day's mode (Grinding, Recovery, Vacation).
2. `/api/coach`: Analyzes the user's `pastTasks`, `checkIn` metrics, and active goals to generate contextual, personalized coaching advice.
3. `/api/insights`: Analyzes the day's focus minutes, prayer rhythm, and check-in scores to produce a daily insights breakdown and life-map commentary across life areas.

*Backend Requirement:* The backend must handle secure storage of OpenRouter/LLM API keys, enforce prompt engineering/JSON schemas, and proxy these requests. Optionally, responses should be saved in database tables for historical audit trails and pattern analysis.

### Voice Notes & Transcription
The app currently features a fully client-side voice transcription pipeline using **WebGPU/WASM and transformers.js** (`app/_voice/whisper.ts`).
- It downloads a ~140MB Whisper model to the browser cache.
- Audio processing and transcription happen entirely on the user's device for privacy.
*Backend Requirement:* No direct backend intervention is required for the transcription itself. However, the backend must be prepared to accept large textual payloads from transcribed notes, and in the future, it could optionally accept the raw audio blobs (e.g., uploading to an S3 bucket) if the user opts-in to cloud storage for their voice memos.

---

## 3. Data Schema & Relationships

To transition to a real database (SQLite or PostgreSQL recommended), the following entities must be modeled. Note that the system recently introduced **Multi-Goal Linking**, where tasks and goals have many-to-many relationships.

### Entity: `Task`
Represents a block of work for a specific day.
```typescript
type Category = "Business" | "Health" | "Learning" | "Faith" | "Ops" | "Life";

type Task = {
  id: string | number; // UUID recommended
  title: string;
  category: Category;
  range: string; // Time block, e.g., "09:00 am - 10:00 am"
  minutes: number;
  done: boolean;
  rolled: number; // Max 4. Increments if not done when day changes.
  kind: "mission" | "support"; 
  details?: string;
  linkedGoalIds?: string[]; // Foreign keys to Goal(s)
  dateKey: string; // e.g. "2026-08-06" - ties task to a specific day
};
```

### Entity: `Horizon`
Timeframes that group goals (e.g., "Next 30 days", "Next 3 months").
```typescript
type Horizon = {
  id: string;
  label: string;
  startDate: string; // ISO Date string
  targetDate: string; // ISO Date string
  progress: number; // Calculated or stored metric
};
```

### Entity: `Goal`
A specific objective residing within a horizon.
```typescript
type Goal = {
  id: string; // UUID
  horizonId: string; // Foreign key to Horizon
  title: string;
  tasksDone: number; // Incremented automatically when linked tasks are completed
  parentGoalIds?: string[]; // Foreign keys to Goals in higher horizons (Cascading linking)
};
```

### Entity: `DailyLog` (The Daily State)
Tracks metadata and metrics for a specific day.
```typescript
type DayMode = "grinding" | "recovery" | "vacation";

type DailyLog = {
  dateKey: string; // Primary Key, e.g., "2026-08-06"
  mode: DayMode;
  challenge: string;
  challengeDone: boolean;
  quranDone: boolean;
  highestTierDone: number;
  energy: number; // 1-10
  pain: number;   // 1-10
  focus: number;  // 1-10
  contextNotes: string[]; // General brain dump for the day
};
```

---

## 4. Business Logic Core: "The Ripple Effect"

The most complex local logic is the **Ripple Effect**. 
When a `Task` is marked as `done = true`:
1. The app identifies the `linkedGoalIds` attached to the task.
2. It increments the `tasksDone` counter for each of those Goals.
3. It recursively checks if those Goals have `parentGoalIds`.
4. It traverses up the chain, incrementing the `tasksDone` counter for *every* connected parent Goal across all higher horizons.

*Backend Requirement:* When a task is updated via API (e.g., `PATCH /api/tasks/:id { done: true }`), the backend MUST execute this recursive ripple effect in a database transaction to ensure data consistency, rather than relying on the client to send multiple update payloads.

---

## 5. Recommended Backend Architecture

For a single-user, personal-grade application, simplicity and portability are key.

### Tech Stack Recommendation
- **Database:** SQLite. It is incredibly fast, portable (just a single file), and perfect for single-user apps. Backing it up is as simple as copying the `.sqlite` file to cloud storage.
- **ORM:** Prisma or Drizzle ORM for type-safe database queries.
- **API:** Node.js (Express, Hono, or Next.js App Router API). 

### Required API Endpoints

#### Data Persistence & Sync Endpoints
1. `GET /api/sync`
   - **Purpose:** On app load, fetches the current day's `DailyLog`, `Tasks` for today/tomorrow, and the full `Horizon`/`Goal` hierarchy. 
   - **Logic:** Should execute the Rollover algorithm if `dateKey` has advanced since the last sync.
2. `PATCH /api/tasks/:id`
   - **Purpose:** Update task status, trigger ripple effects.
3. `POST /api/tasks` & `DELETE /api/tasks/:id`
   - **Purpose:** Manage the task list.
4. `PATCH /api/goals/:id`
   - **Purpose:** Update goal titles, or modify `parentGoalIds` linkages.
5. `PATCH /api/daily-log/:dateKey`
   - **Purpose:** Update habits, metrics, and day modes.

#### AI Service Endpoints (Proxied & Persisted by Backend)
6. `POST /api/arrange`
   - **Input:** `{ mode: DayMode, draftTasks: DraftTask[], dateKey: string }`
   - **Output:** Structured JSON array of ordered, timed tasks for the day.
   - **Backend Role:** Prompts LLM, validates structured JSON response, and returns formatted tasks.
7. `POST /api/coach`
   - **Input:** `{ context: CoachContext }` (includes past tasks, current goals, check-in data)
   - **Output:** `{ advice: string, focusArea: string, actionItem: string }`
   - **Backend Role:** Evaluates user performance history with LLM and returns actionable coaching feedback.
8. `POST /api/insights`
   - **Input:** `{ context: CoachContext }`
   - **Output:** `{ headline: string, stat: string, risk: string, lifeMap: Array<{ name: string, insight: string }> }`
   - **Backend Role:** Computes factual daily commentary across life dimensions using LLM structured output.

### Optimistic UI
The frontend currently feels instantly responsive because it edits local React state immediately. 
When integrating the backend, the frontend should continue to use **Optimistic Updates**:
1. User clicks a checkbox.
2. React state updates immediately (and executes the visual ripple effect locally).
3. API call is made in the background to sync the change to the database.

---

## 6. Actionable Next Steps for the Backend Dev

1. **Initialize the Database:** Set up SQLite and create the tables using the schemas outlined in Section 3. Use an intersection table for the many-to-many relationships (`TaskGoals`, `GoalParents`).
2. **Implement the Rollover Cron/Lazy-load:** Write the logic that archives tasks and resets daily metrics when the clock rolls past midnight in the user's timezone (Cairo time is currently hardcoded in the frontend).
3. **Build the Sync Endpoint:** Expose a single `/sync` endpoint that returns the unified state payload.
4. **Migrate Existing Data:** Write a one-off script that accepts the massive JSON payload from the user's browser `localStorage` and seeds the SQLite database so no historical data is lost.
