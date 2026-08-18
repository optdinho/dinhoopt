---
name: native-module
description: >
  Patterns for native module integration in DiNho Optimizer:
  better-sqlite3 (N-API), C# engine child process lifecycle,
  named pipe communication, ffmpeg path resolution, and electron-rebuild.
origin: project
date_added: 2026-08-17
---

# Native Module Patterns — DiNho Optimizer

## better-sqlite3 (N-API)

### Lifecycle

```ts
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';

const dbPath = path.join(app.getPath('userData'), 'app.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
```

### Common Pitfalls

- **`better-sqlite3` v13+ is N-API** — requires Node ≥22 (matches `engines.node` in `package.json`)
- **`bindings` package** — used by `better-sqlite3` to find the `.node` native addon; must be in `dependencies` (not `devDependencies`)
- **electron-rebuild** — run after `npm install` if native modules fail to load: `npx electron-rebuild -f -w better-sqlite3`
- **WAL mode** — always enable for concurrent reads; `journal_mode = WAL` on first connection
- **Synchronous API** — `better-sqlite3` is sync by design; never call from renderer (blocks UI). Use IPC handler in main process.

### IPC Handler Pattern

```ts
// src/main/ipc/database.ipc.ts
import Database from 'better-sqlite3';
import { ipcMain } from 'electron';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

ipcMain.handle('db:get', (_event, key: string) => {
  return getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key);
});

ipcMain.handle('db:set', (_event, key: string, value: string) => {
  getDb().prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, value);
});
```

### Testing

```ts
// Mock better-sqlite3 at module level
vi.mock('better-sqlite3', () => {
  const mockDb = {
    pragma: vi.fn(),
    prepare: vi.fn(() => ({
      get: vi.fn(),
      all: vi.fn(() => []),
      run: vi.fn(),
    })),
    close: vi.fn(),
  };
  return { default: vi.fn(() => mockDb) };
});
```

## C# Engine Child Process

### Lifecycle

```
EngineCoordinator.StartAsync()
  → Process.Start("DiNho.Capture.Poc.exe", "--json-status")
  → Named pipe connection (server: Electron, client: engine)
  → Config sync via pipe
  → Capture loop (WGC/DXGI → GPU convert → ffmpeg encoder)
```

### Start/Stop

```ts
// src/main/ipc/clips-engine-connection.ts
const engineProcess = spawn(enginePath, ['--json-status'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

// Graceful stop
engineProcess.kill('SIGTERM');
setTimeout(() => {
  if (!engineProcess.killed) engineProcess.kill('SIGKILL');
}, 5000);
```

### Key Rules

- **Never hardcode engine path** — use `FfmpegPathResolver` pattern or env var fallback chain
- **Self-contained publish** — engine bundles .NET runtime (`--self-contained true -r win-x64`)
- **Named pipe is IPC** — all commands go through `sendPipeCommand()`, never stdout
- **Stdout/stderr are diagnostics only** — log but don't parse for control flow

## Named Pipe Communication

### Pattern

```ts
import net from 'node:net';

const PIPE_NAME = '\\\\.\\pipe\\dinho-clips-engine';

function connectPipe(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(PIPE_NAME);
    socket.on('connect', () => resolve(socket));
    socket.on('error', reject);
  });
}

// Send command, wait for response
async function sendWithFallback(command: string, payload?: unknown): Promise<unknown> {
  if (!pipeConnected) throw new Error('Pipe not connected');
  const id = ++requestId;
  pendingRequests.set(id, { resolve, reject });
  pipeSocket.write(JSON.stringify({ cmd: command, payload, id }) + '\n');
}
```

### Pipe Message Format

```jsonc
// Request (Electron → Engine)
{ "cmd": "setConfig", "payload": { "cq": 22 }, "id": 42 }

// Response (Engine → Electron)
{ "cmd": "setConfig", "status": "ok", "id": 42 }

// Status broadcast (Engine → Electron, no cmd)
{ "event": "status", "fps": 60, "game": "FiveM", "recording": false }
```

### Common Pitfalls

- **Pipe reconnect on close** — engine may restart; implement exponential backoff (3s default)
- **Request/response matching** — always use `id` field; never assume ordering
- **Fire-and-forget** — some commands don't need response (e.g., `stopEngine`)
- **Large payloads** — pipe buffer is 64KB; chunk if needed (rare for status updates)

## FFmpeg Path Resolution

### FfmpegPathResolver Pattern

```ts
// src/main/services/ffmpeg-path-resolver.ts
import { app } from 'electron';

const CANDIDATES = [
  process.env.FFMPEG_PATH,                                    // env override
  path.join(app.getPath('exe'), '..', 'ffmpeg.exe'),           // packaged
  path.join(__dirname, '../../ffmpeg.exe'),                     // dev
  path.join(app.getPath('userData'), 'ffmpeg.exe'),             // user data
];

export function getFfmpegPath(): string {
  for (const candidate of CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('ffmpeg not found');
}
```

### C# Engine Path

```ts
// src/main/ipc/clips-engine-connection.ts
const ENGINE_CANDIDATES = [
  process.env.ENGINE_PATH,
  path.join(app.getPath('exe'), '..', 'resources/clips-engine/DiNho.Capture.Poc.exe'),
  path.join(__dirname, '../../resources/clips-engine/DiNho.Capture.Poc.exe'),
  path.join(app.getPath('userData'), 'clips-engine/DiNho.Capture.Poc.exe'),
];
```

## electron-rebuild

```bash
# After npm install
npx electron-rebuild -f -w better-sqlite3

# In CI/package script
"postinstall": "electron-rebuild"
```

### Why Needed

- Native `.node` addons are compiled against system Node headers
- Electron uses its own Node version → ABI mismatch
- `electron-rebuild` recompiles against Electron's headers

### N-API Advantage

- `better-sqlite3` v13+ uses N-API (ABI-stable)
- **No rebuild needed** when Electron updates Node minor version
- Still need rebuild if Electron major version changes Node ABI (rare)
