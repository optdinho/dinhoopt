---
name: electron-ipc
description: "Electron IPC patterns for DiNho Optimizer: channel registration, preload bridge, validation, named pipes to C# engine. Use when adding/modifying IPC handlers, channels, or preload methods."
origin: project
date_added: "2026-08-18"
---

# Electron IPC Patterns

Expert IPC architecture for DiNho Optimizer. Covers the full channel lifecycle: shared definition → main handler → preload bridge → renderer call.

## When to Activate

- Adding new IPC channels
- Modifying existing handlers
- Creating preload methods
- Wiring renderer calls to main process
- Adding C# engine pipe commands
- Debugging "No handler registered" errors

## Do NOT Use When

- Building renderer-only UI (use `frontend-patterns`)
- Writing C# engine code (use `csharp-engine`)
- Fixing build errors (use `build-error-resolver`)

## Architecture

```
Renderer (React)
  ↓ window.dinho.method()
Preload (src/preload/)
  ↓ ipcRenderer.invoke(CHANNEL, ...args)
Main (src/main/ipc/)
  ↓ handler function
Shared channels (src/shared/channels.ts)
```

## Step-by-Step: Adding a Channel

### 1. Define channel name

```typescript
// src/shared/channels.ts
export const CLIPS_MY_ACTION = 'clips:my-action' as const
```

**Rule**: Always prefix with domain (`clips:`, `malware:`, `game-mode:`, etc.)

### 2. Register handler in main

```typescript
// src/main/ipc/clips.ipc.ts
ipcMain.handle(CLIPS_MY_ACTION, async (_event, arg1: string, arg2: number) => {
  try {
    // Validate input
    if (typeof arg1 !== 'string' || arg1.length === 0) {
      return { success: false, error: 'Invalid arg1' }
    }
    // Do work
    const result = await doSomething(arg1, arg2)
    return { success: true, data: result }
  } catch (err) {
    getLogger().error('clips', `MyAction failed: ${err}`)
    return { success: false, error: String(err) }
  }
})
```

**Rules**:
- ALWAYS wrap in try/catch
- ALWAYS validate input types
- ALWAYS return `{ success: boolean, ... }` pattern
- NEVER throw from handler (renderer gets unhandled rejection)

### 3. Add preload method

```typescript
// src/preload/clips.ts
export const clipsMyAction = (arg1: string, arg2: number): Promise<{ success: boolean; data?: unknown; error?: string }> =>
  ipcRenderer.invoke(CLIPS_MY_ACTION, arg1, arg2)
```

### 4. Expose on window.dinho

```typescript
// src/preload/index.ts
import { clipsMyAction } from './clips'

contextBridge.exposeInMainWorld('dinho', {
  // ...existing methods
  clipsMyAction,
})
```

### 5. Call from renderer

```typescript
// src/renderer/src/pages/ClipsPage.tsx
const result = await window.dinho?.clipsMyAction('test', 42)
if (result?.success) {
  // handle success
}
```

## Validation Pattern

```typescript
// In main handler
function validateInput(input: unknown): input is MyType {
  return (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as MyType).name === 'string' &&
    (input as MyType).name.length > 0 &&
    (input as MyType).name.length < 256
  )
}
```

## Path Traversal Prevention

For any handler that accepts file paths:

```typescript
import { clipPathInOutputDir } from '../services/clips-config-manager'

const resolved = clipPathInOutputDir(userPath)
if (resolved === null) {
  return { success: false, error: 'Path outside allowed directory' }
}
```

## Named Pipe Protocol (C# Engine)

For clips engine communication:

```typescript
// src/main/ipc/clips-engine-connection.ts
async function sendPipeCommand(cmd: string, payload?: unknown): Promise<unknown> {
  if (!isPipeConnected()) throw new Error('Pipe not connected')
  const msg = JSON.stringify({ cmd, payload })
  return new Promise((resolve, reject) => {
    pendingRequests.set(cmd, { resolve, reject })
    socket.write(msg + '\n')
  })
}
```

**Rules**:
- Always check `isPipeConnected()` before send
- Handle timeout (default 5s)
- Handle pipe disconnect gracefully
- Never block main thread on pipe I/O

## Common Anti-Patterns

### ❌ Handler that throws
```typescript
ipcMain.handle('bad', () => {
  throw new Error('fail') // Renderer gets unhandled rejection
})
```

### ✅ Handler that returns error
```typescript
ipcMain.handle('good', async () => {
  try { /* ... */ }
  catch (err) { return { success: false, error: String(err) } }
})
```

### ❌ Missing channel in shared/channels.ts
```typescript
// ipcMain.handle('clips:undeclared') — typo won't be caught
```

### ✅ Always import from shared
```typescript
import { CLIPS_MY_ACTION } from '@shared/channels'
ipcMain.handle(CLIPS_MY_ACTION, handler)
```

### ❌ Renderer not checking result
```typescript
const r = await window.dinho?.clipsAction()
r.data.foo // r could be undefined
```

### ✅ Null-safe call
```typescript
const r = await window.dinho?.clipsAction()
if (r?.success) use(r.data)
```

## Testing

```typescript
// src/main/ipc/clips.ipc.test.ts
describe('CLIPS_MY_ACTION', () => {
  it('returns success with valid input', async () => {
    const result = await handler({}, 'valid', 42)
    expect(result.success).toBe(true)
  })

  it('rejects invalid input', async () => {
    const result = await handler({}, '', 42)
    expect(result.success).toBe(false)
  })
})
```

## File Organization

```
src/shared/channels.ts          ← channel name constants
src/shared/types.ts             ← shared TS types
src/main/ipc/*.ipc.ts           ← main process handlers
src/preload/*.ts                ← preload bridge methods
src/preload/index.ts            ← window.dinho exposure
src/renderer/src/pages/*.tsx    ← renderer calls
```
