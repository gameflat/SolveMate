# SolveMate

SolveMate is a local AI-assisted practice website for multiple private question banks.

Current banks:

- `Question Bank/烯烃事业部题库（MTO装置LORU单元）.docx` as the default bank
- `Question Bank/竞赛题库5.22.xlsx` as the retained legacy bank, available from “过往题库”

## Features

- Current-bank and legacy-bank switching
- Random, sequential, custom-selection, and mistake-review practice
- Question-bank browser with search and direct question selection
- Previous and next question navigation
- Type filters for single-choice, multiple-choice, true/false, fill-in-the-blank, and short-answer questions
- Fill-in-the-blank questions render one input per blank
- Server-side account state for stats, progress, mistake records, and favorites
- Daily, weekly, monthly, per-question, average-time, and check-in statistics using China time
- AI explanation generation with local cache and manual regeneration
- Cached explanations are shown automatically after answering
- AI follow-up Q&A for each question
- AI quick grading for short-answer questions
- Simple username/password protection for private deployments

## Quick Start

```bash
npm install
npm start
```

Open [http://localhost:8787](http://localhost:8787).

`npm start` builds the frontend, then starts the Express server on port `8787`. In production, the server serves both the API and the built static files — no separate Vite dev server is needed.

During development, use `npm run dev` to start the Vite dev server on `5173` with hot-reload alongside the Express API on `8787`.

## Public Tunnel Hosts

Vite blocks unknown Host headers during development. `frp-put.com`, `*.cpolar.cn`, and `*.cpolar.top` are already allowed in `vite.config.ts`.

For additional tunnel domains, set comma-separated hosts in `.env`:

```bash
VITE_ALLOWED_HOSTS=example.com,another.example.com
```

## Authentication

When deploying SolveMate to a public network, configure one to three private users:

```bash
# .env
AUTH_USERS=alice:alice_password,bob:bob_password
```

For a single-user setup, the old password-only mode is still supported:

```bash
# .env
AUTH_PASSWORD=your_password
```

- Leave `AUTH_USERS` and `AUTH_PASSWORD` empty to disable authentication (default local-only mode).
- With only `AUTH_PASSWORD`, the login username can be left blank.
- `AUTH_COOKIE_SECRET` signs session cookies. Leave empty to auto-generate (sessions reset on server restart).
- `AUTH_SESSION_DAYS` controls session duration (default 7 days).

Runtime account data is stored in `data/user-store.json`, which is ignored by git.

Protected endpoints (`401` when unauthenticated) include:
- `GET /api/banks`
- `GET /api/questions`
- `GET /api/me`
- `POST /api/me/*`
- `GET /api/questions/:id/explanation`
- `POST /api/questions/:id/chat`
- `POST /api/questions/:id/grade`
- `POST /api/explanations/prewarm`

Public endpoint: `/api/health`.

## AI Configuration

Copy `.env.example` to `.env` and set an OpenAI-compatible chat completions endpoint:

```bash
cp .env.example .env
```

Required value:

```bash
LLM_API_KEY=your_api_key
```

Optional values:

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
AI_PREGENERATE_ON_START=false
```

When `AI_PREGENERATE_ON_START=true` and `LLM_API_KEY` is configured, the backend starts generating missing explanations into `.cache/ai-explanations.json` after launch. The default is off; use the AI page button for manual prewarm when needed.

## Question Bank

The runtime reads normalized banks from `data/question-banks.json`. To regenerate that file from the Excel and Word source files:

```bash
npm run import:questions
```

The import script uses Python `openpyxl` and `python-docx`. It also writes `data/import-report.json` for parse-quality checks and `data/questions.json` as a compatibility export of the default bank.

## Project Layout

- `src/`: React frontend
- `server/`: Express API and LLM integration
- `data/question-banks.json`: normalized multi-bank question data
- `data/import-report.json`: import validation summary
- `data/questions.json`: compatibility export of the default bank
- `scripts/`: start, stop, status, and import utilities
- `docs/`: operational notes
