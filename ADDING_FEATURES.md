# Adicionando Funcionalidades

Este guia mostra como adicionar um novo módulo ao projeto seguindo o padrão existente.

---

## Visão geral do fluxo de dados

```
Renderer (React)          Preload (bridge)       Main Process (Node.js)
─────────────────         ────────────────       ──────────────────────
Page.tsx                                         ipc/meu-modulo.ipc.ts
  └─ store.ts  ──── window.kudu.meuModulo() ──►  IPC handler
       ▲                                               └─ platform/win32/
       └────────────────── resultado ◄──────────────────   ou services/
```

---

## Passo a passo: criar um novo módulo

### 1. Canal IPC — `src/shared/channels.ts`

Adicione as constantes de canal para seu módulo:

```typescript
// Em src/shared/channels.ts, dentro do objeto IPC:
MEU_MODULO_SCAN:  'meu-modulo:scan',
MEU_MODULO_CLEAN: 'meu-modulo:clean',
MEU_MODULO_PROGRESS: 'meu-modulo:progress',
```

### 2. Handler IPC — `src/main/ipc/meu-modulo.ipc.ts`

```typescript
import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/channels'
import type { WindowGetter } from './index'

export function registerMeuModuloIpc(getWindow: WindowGetter): void {
  // Handler de scan
  ipcMain.handle(IPC.MEU_MODULO_SCAN, async (_event) => {
    // Sua lógica aqui — pode usar:
    //   getPlatform() para código win32 nativo
    //   execFile / spawn para processos externos
    //   PowerShell via psUtf8()
    const resultados = await fazScan()
    return resultados
  })

  // Handler de clean com progresso
  ipcMain.handle(IPC.MEU_MODULO_CLEAN, async (_event, items: string[]) => {
    const win = getWindow()
    let processados = 0

    for (const item of items) {
      await deletaItem(item)
      processados++
      // Envia progresso para o renderer
      win?.webContents.send(IPC.MEU_MODULO_PROGRESS, {
        current: processados,
        total: items.length,
        currentItem: item,
      })
    }

    return { cleaned: processados }
  })
}
```

### 3. Registrar o handler — `src/main/ipc/index.ts`

```typescript
// Importe no topo
import { registerMeuModuloIpc } from './meu-modulo.ipc'

// Adicione dentro de registerCleanerIpc():
export function registerCleanerIpc(getWindow: WindowGetter): void {
  // ... handlers existentes ...
  registerMeuModuloIpc(getWindow)  // ← adicione aqui
}
```

### 4. Expor no Preload — `src/preload/index.ts`

```typescript
// Adicione dentro do objeto exposto via contextBridge:
meuModulo: {
  scan: () => ipcRenderer.invoke(IPC.MEU_MODULO_SCAN),
  clean: (items: string[]) => ipcRenderer.invoke(IPC.MEU_MODULO_CLEAN, items),
  onProgress: (cb: (data: MeuModuloProgress) => void) =>
    ipcRenderer.on(IPC.MEU_MODULO_PROGRESS, (_e, data) => cb(data)),
},
```

### 5. Store Zustand — `src/renderer/src/stores/meu-modulo-store.ts`

```typescript
import { create } from 'zustand'

interface MeuModuloItem {
  id: string
  nome: string
  tamanho: number
}

interface MeuModuloStore {
  items: MeuModuloItem[]
  selecionados: Set<string>
  scanning: boolean
  cleaning: boolean
  progresso: number

  scan: () => Promise<void>
  clean: () => Promise<void>
  toggleItem: (id: string) => void
  selecionarTodos: () => void
}

export const useMeuModuloStore = create<MeuModuloStore>((set, get) => ({
  items: [],
  selecionados: new Set(),
  scanning: false,
  cleaning: false,
  progresso: 0,

  scan: async () => {
    set({ scanning: true, items: [] })
    try {
      const resultado = await window.kudu.meuModulo.scan()
      set({ items: resultado })
    } finally {
      set({ scanning: false })
    }
  },

  clean: async () => {
    set({ cleaning: true, progresso: 0 })
    const { selecionados } = get()

    // Escuta progresso
    window.kudu.meuModulo.onProgress((data) => {
      set({ progresso: Math.round((data.current / data.total) * 100) })
    })

    try {
      await window.kudu.meuModulo.clean([...selecionados])
    } finally {
      set({ cleaning: false, items: [], selecionados: new Set() })
    }
  },

  toggleItem: (id) => set((s) => {
    const sel = new Set(s.selecionados)
    sel.has(id) ? sel.delete(id) : sel.add(id)
    return { selecionados: sel }
  }),

  selecionarTodos: () => set((s) => ({
    selecionados: new Set(s.items.map((i) => i.id))
  })),
}))
```

### 6. Página React — `src/renderer/src/pages/MeuModuloPage.tsx`

```tsx
import { useEffect } from 'react'
import { useMeuModuloStore } from '../stores/meu-modulo-store'

export function MeuModuloPage() {
  const { items, scanning, cleaning, progresso, scan, clean, toggleItem, selecionarTodos } =
    useMeuModuloStore()

  useEffect(() => {
    if (items.length === 0 && !scanning) scan()
  }, [])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-4">Meu Módulo</h1>

      {scanning && <p className="text-muted-foreground">Analisando...</p>}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border">
              <input
                type="checkbox"
                onChange={() => toggleItem(item.id)}
              />
              <span>{item.nome}</span>
              <span className="ml-auto text-sm text-muted-foreground">
                {(item.tamanho / 1024 / 1024).toFixed(1)} MB
              </span>
            </div>
          ))}
        </div>
      )}

      {cleaning && (
        <div className="mt-4">
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progresso}%` }}
            />
          </div>
          <p className="text-sm mt-1">{progresso}%</p>
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button onClick={scan} disabled={scanning} className="btn-secondary">
          Analisar
        </button>
        <button onClick={clean} disabled={cleaning || items.length === 0} className="btn-primary">
          Limpar selecionados
        </button>
      </div>
    </div>
  )
}
```

### 7. Adicionar a rota — `src/renderer/src/App.tsx`

```tsx
// Importe a página
import { MeuModuloPage } from './pages/MeuModuloPage'

// Adicione dentro de <Routes>:
<Route path="/meu-modulo" element={<MeuModuloPage />} />
```

### 8. Adicionar ao menu lateral

Encontre o componente de navegação (geralmente `src/renderer/src/components/layout/AppShell.tsx`)
e adicione uma entrada para `/meu-modulo`.

---

## Dicas para usar PowerShell no main

A maioria das funcionalidades Windows usa PowerShell. Use o helper já disponível:

```typescript
import { psUtf8 } from '../services/exec-utf8'

const resultado = await psUtf8([
  '-NoProfile', '-NonInteractive', '-Command',
  'Get-Process | Select-Object Name, CPU | ConvertTo-Json'
])
// resultado.stdout contém o JSON
```

## Lendo o registro do Windows

```typescript
import { psUtf8 } from '../services/exec-utf8'

const { stdout } = await psUtf8([
  '-NoProfile', '-Command',
  `Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' |
   Select-Object DisplayName, DisplayVersion | ConvertTo-Json`
])
const apps = JSON.parse(stdout)
```

## Verificando se é admin

```typescript
import { getPlatform } from '../platform'

const plat = getPlatform()
if (!plat.elevation.isAdmin()) {
  // Pede para reiniciar como admin
}
```

---

## Adicionando rules JSON (cleaners sem código)

Para suporte a um novo app nos módulos de limpeza:

```bash
npm run new-rule
```

Ou edite manualmente `rules/win32/apps.json`:

```json
{
  "id": "meu-app",
  "name": "Meu App",
  "paths": [
    "${LOCALAPPDATA}\\MeuApp\\Cache",
    "${APPDATA}\\MeuApp\\logs"
  ]
}
```

Variáveis disponíveis: `${LOCALAPPDATA}`, `${APPDATA}`, `${TEMP}`, `${USERPROFILE}`, `${PROGRAMDATA}`.
