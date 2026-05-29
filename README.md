# SolveMate

SolveMate is a local AI-assisted practice website for the question bank in `Question Bank/竞赛题库5.22.xlsx`.

## Features

- Random and sequential practice
- Question-bank browser with search and direct question selection
- Previous and next question navigation
- Type filters for single-choice, multiple-choice, true/false, fill-in-the-blank, and short-answer questions
- Fill-in-the-blank questions render one input per blank
- Practice timer, accuracy statistics, mistake records, and favorites
- AI explanation generation with local cache and manual regeneration
- Cached explanations are shown automatically after answering
- AI follow-up Q&A for each question
- AI quick grading for short-answer questions

## Quick Start

```bash
npm install
npm start
```

Open [http://localhost:5173](http://localhost:5173).

Useful commands:

```bash
npm run status
npm stop
npm run typecheck
npm run build
npm run import:questions
```

`npm start` runs the Express API on `8787` and the Vite frontend on `5173` in the background. Logs are written to `logs/solvemate-server.log` and `logs/solvemate-client.log`.

## Public Tunnel Hosts

Vite blocks unknown Host headers during development. `frp-put.com`, `*.cpolar.cn`, and `*.cpolar.top` are already allowed in `vite.config.ts`.

For additional tunnel domains, set comma-separated hosts in `.env`:

```bash
VITE_ALLOWED_HOSTS=example.com,another.example.com
```

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
AI_PREGENERATE_ON_START=true
```

When `AI_PREGENERATE_ON_START=true` and `LLM_API_KEY` is configured, the backend starts generating missing explanations into `.cache/ai-explanations.json` after launch.

## Question Bank

The runtime reads normalized questions from `data/questions.json`. To regenerate that file from the Excel workbook:

```bash
npm run import:questions
```

The import script uses Python `openpyxl`, so run it in an environment where `openpyxl` is installed.

## Project Layout

- `src/`: React frontend
- `server/`: Express API and LLM integration
- `data/questions.json`: normalized question data
- `scripts/`: start, stop, status, and import utilities
- `docs/`: operational notes
