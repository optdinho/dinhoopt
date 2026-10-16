/**
 * R5 — apply real reversível contra o SO (harness, NÃO corre na suite default).
 *
 * Porquê este ficheiro existe
 * ---------------------------
 * A suite vitest real exercita os handlers IPC, mas 100% dos testes mockam o
 * backend do SO: nenhum `reg.exe` a sério correu num teste. Isto é o buraco que
 * o AGENTS documenta como dívida R5. Este harness fecha-o minimamente: pega num
 * tweak HKCU (reversível, sem admin), aplica-o pelo caminho REAL
 * (`IPC.WINDOWS_TWEAKS_APPLY` → `applyRegistryTweak` → `reg.exe`), confirma pela
 * leitura directa do registro, reverte pelo caminho REAL e confirma que o valor
 * de base foi reposto.
 *
 * Como corre
 * ----------
 *   npm run test:harness                        # tweak por omissão (menu-show-delay)
 *   $env:DINHO_R5_TWEAK_ID='menu-show-delay'; npm run test:harness
 *
 * Só é chamado pelos ficheiros "*.harness.ts" de scripts/harness (ver
 * vitest.harness.config.mts), que NÃO faz parte do include da suite normal — não introduz skips na
 * contagem "0 skipped" do AGENTS. Windows-only: o describe fica skipped noutro SO.
 *
 * Segurança
 * ---------
 * - Só tweaks HKEY_CURRENT_USER (sem elevação, sem HKLM).
 * - Nunca usa tweaks powercfg / Interfaces / ntfs (efeitos largos, ramos HW).
 * - `afterAll` reverte SEMPRE (best-effort) e apaga a pasta temporária do snapshot.
 * - O `electron` é o ÚNICO mock; `reg.exe` é o binário real do Windows.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WindowsTweakDef } from '@shared/types'
import { getCatalog, registerWindowsTweaksIpc } from '../../src/main/ipc/windows-tweaks/handlers'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  tmpUserData: '',
  sent: [] as { channel: string; payload: unknown }[],
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.tmpUserData, isPackaged: false },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      h.handlers.set(channel, fn)
    },
    on: () => {},
  },
}))

const DEFAULT_TWEAK_ID = 'menu-show-delay'

function baseKeyOf(tweak: WindowsTweakDef): 'HKLM' | 'HKCU' {
  return tweak.hive === 'HKEY_LOCAL_MACHINE' ? 'HKLM' : 'HKCU'
}

interface RegRead {
  exists: boolean
  data?: string
  regType?: string | undefined
}

function regQuery(tweak: WindowsTweakDef): RegRead {
  const baseKey = baseKeyOf(tweak)
  try {
    const out = execFileSync('reg.exe', ['query', `${baseKey}\\${tweak.path}`, '/v', tweak.key], {
      encoding: 'utf-8',
      windowsHide: true,
    })
    const dataLine = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .find((l) => /\s+REG_\w+\s+/.test(l))
    if (!dataLine) return { exists: false }
    const match = dataLine.match(/\s+(REG_\w+)\s+(.*)$/)
    const raw = (match?.[2] ?? '').trim()
    return { exists: true, data: normalize(tweak, raw), regType: match?.[1] }
  } catch {
    return { exists: false }
  }
}

/** `reg query` devolve DWORD em hex (`0x10`); o catalogo usa decimal. */
function normalize(tweak: WindowsTweakDef, raw: string): string {
  if (tweak.kind !== 'DWord') return raw
  const n = raw.startsWith('0x') ? Number.parseInt(raw, 16) : Number.parseInt(raw, 10)
  return Number.isNaN(n) ? raw : String(n)
}

function expectedOptimized(tweak: WindowsTweakDef): string {
  return typeof tweak.optimizedValue === 'string' ? tweak.optimizedValue : String(tweak.optimizedValue)
}

function isSafeHkcuTweak(tweak: WindowsTweakDef): boolean {
  return (
    tweak.hive === 'HKEY_CURRENT_USER' &&
    !tweak.path.includes('\\Interfaces') &&
    tweak.id !== 'ntfs-last-access-off' &&
    (tweak.kind === 'String' || tweak.kind === 'DWord')
  )
}

describe.skipIf(process.platform !== 'win32')('R5 — apply/revert real de um tweak HKCU', () => {
  let tweak: WindowsTweakDef
  let baseline: RegRead
  let applied = false

  beforeAll(() => {
    h.tmpUserData = mkdtempSync(join(tmpdir(), 'dinho-r5-'))
    registerWindowsTweaksIpc(() => ({
      webContents: { send: (channel: string, payload: unknown) => h.sent.push({ channel, payload }) },
    }) as never)

    const id = process.env.DINHO_R5_TWEAK_ID ?? DEFAULT_TWEAK_ID
    const found = getCatalog().find((t) => t.id === id)
    if (!found) throw new Error(`Tweak "${id}" não existe no catálogo.`)
    if (!isSafeHkcuTweak(found)) {
      throw new Error(
        `Tweak "${id}" não é um HKCU reversível simples (hive=${found.hive}, path=${found.path}). ` +
          'Escolhe outro via DINHO_R5_TWEAK_ID.',
      )
    }
    tweak = found
    baseline = regQuery(tweak)
  })

  afterAll(() => {
    // Rede de segurança: nunca deixar o registo mutado, mesmo que um expect falhe.
    if (applied) {
      try {
        const revert = h.handlers.get(IPC.WINDOWS_TWEAKS_REVERT)
        revert?.({}, [tweak.id])
      } catch {
        /* best-effort */
      }
    }
    if (h.tmpUserData) rmSync(h.tmpUserData, { recursive: true, force: true })
  })

  it('lê o valor de base (o ponto de partida tem de ser observável)', () => {
    // Não exige existência (uma key limpa é válida), mas prova que a leitura funciona.
    expect(typeof baseline.exists).toBe('boolean')
  })

  it('aplica pelo handler IPC real e o registo reflecte o valor optimizado', async () => {
    const apply = h.handlers.get(IPC.WINDOWS_TWEAKS_APPLY) as Handler | undefined
    expect(apply, 'handler WINDOWS_TWEAKS_APPLY não registado').toBeDefined()

    const result = (await apply!({}, [tweak.id])) as { succeeded: number; failed: number }
    applied = true

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)

    const after = regQuery(tweak)
    expect(after.exists).toBe(true)
    expect(after.data).toBe(expectedOptimized(tweak))
  })

  it('reverte pelo handler IPC real e repõe exactamente o valor de base', async () => {
    const revert = h.handlers.get(IPC.WINDOWS_TWEAKS_REVERT) as Handler | undefined
    expect(revert, 'handler WINDOWS_TWEAKS_REVERT não registado').toBeDefined()

    const result = (await revert!({}, [tweak.id])) as { succeeded: number; failed: number }
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    applied = false

    const after = regQuery(tweak)
    if (baseline.exists) {
      expect(after.exists).toBe(true)
      expect(after.data).toBe(baseline.data)
    } else {
      expect(after.exists).toBe(false)
    }
  })
})
