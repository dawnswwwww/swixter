# Swixter UI Daemon Mode Design

## Overview

Add daemon mode support to `swixter ui` command, enabling background server management with status checking, stop control, and auto-browser-open when a running instance is detected.

## Commands

| Command | Behavior |
|---------|----------|
| `swixter ui` | Check existing instance → if alive, open browser only; otherwise start in foreground |
| `swixter ui --daemon` | Start server in background (detached), write PID file, redirect logs to `ui.log` |
| `swixter ui --daemon --port 8080` | Background start with custom port |
| `swixter ui --stop` | Read PID file → kill process → clean up file |
| `swixter ui --status` | Read PID file → dual verification → print running status |

## PID File

- **Path**: `~/.config/swixter/ui.pid`
- **Format**: JSON

```json
{
  "pid": 12345,
  "port": 3141,
  "startTime": "2026-04-26T12:00:00.000Z"
}
```

## Dual Verification (Process Alive Detection)

```js
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isSwixterUiRunning(pid, port) {
  if (!isProcessAlive(pid)) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/version`);
    return res.ok;
  } catch {
    return false;
  }
}
```

If either check fails, the PID file is considered stale and should be removed.

## Daemon Startup Flow

1. Parent process detects `--daemon`, filters it from args
2. Determine port (from `--port` arg or auto-discover)
3. Spawn child process:
   ```js
   spawn(process.argv0, [scriptPath, "ui", "--port", String(port)], {
     detached: true,
     stdio: ["ignore", logFd, logFd]
   })
   ```
4. Child process starts server normally (no `--daemon`)
5. Parent process polls `fetch(http://127.0.0.1:port/api/version)` for up to 10 seconds
6. On success: write PID file, print info, exit
7. On timeout: kill child process, report error, exit

## Logging

- **Foreground mode**: stdout (existing behavior, unchanged)
- **Daemon mode**: append to `~/.config/swixter/ui.log`

## Auto Browser Open

When `swixter ui` is run without `--daemon`:
1. Check PID file existence
2. If exists, run dual verification
3. If alive → call `openBrowser(url)` and exit
4. If not alive → remove stale PID file, start server in foreground normally

## Files to Modify

- `src/cli/ui.ts` — add daemon/stop/status handling
- `src/cli/help.ts` — update help text for new flags
- `src/server/index.ts` — potentially expose port info for PID file

## Error Handling

- Stale PID file (process dead) → silently clean up, continue
- Port already in use → try next available port (existing behavior)
- Daemon start timeout → kill child, report failure
- Stop with no PID file → report "not running"
