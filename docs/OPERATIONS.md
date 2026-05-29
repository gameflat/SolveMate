# Operations

## Start

```bash
npm start
```

This command creates:

- `.run/solvemate-server.pid`
- `.run/solvemate-client.pid`
- `logs/solvemate-server.log`
- `logs/solvemate-client.log`

The frontend is available at `http://localhost:5173`, and the API is available at `http://localhost:8787`.

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
tail -f logs/solvemate-server.log
tail -f logs/solvemate-client.log
```

## Health Check

```bash
curl http://localhost:8787/api/health
```

The health response includes question count, AI configuration state, explanation cache count, and background pre-generation progress.

## Git Notes

Generated runtime files are ignored:

- `.env`
- `.cache/`
- `.run/`
- `logs/`
- `dist/`
- `node_modules/`
