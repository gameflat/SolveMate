# Operations

## Start

```bash
npm start
```

This command creates:

- `.run/solvemate.pid`
- `logs/solvemate.log`

The production build and API are both served at `http://localhost:8787`.

For hot-reload development, use:

```bash
npm run dev
```

This starts Vite on `http://localhost:5173` and the API on `http://localhost:8787`.

## Stop

```bash
npm stop
```

The stop script first uses the PID file when available, then clears any remaining processes bound to ports `5173` and `8787`.

## Status

```bash
npm run status
```

This reports the PID file state, port usage, and log file path.

## Logs

```bash
tail -f logs/solvemate.log
```

## Health Check

```bash
curl http://localhost:8787/api/health
```

The health response includes bank counts, AI configuration state, explanation cache count, and background pre-generation progress.

## Git Notes

Generated runtime files are ignored:

- `.env`
- `.cache/`
- `.run/`
- `logs/`
- `dist/`
- `node_modules/`
- `data/user-store.json`
