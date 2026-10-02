import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warning: vi.fn() }
  const stdoutHandlers: Array<(chunk: Buffer) => void> = []
  const stderrHandlers: Array<(chunk: Buffer) => void> = []
  const child = {
    pid: 4242,
    killed: false,
    kill: vi.fn(),
    stdout: {
      on: (_event: string, cb: (chunk: Buffer) => void) => {
        stdoutHandlers.push(cb)
      },
    },
    stderr: {
      on: (_event: string, cb: (chunk: Buffer) => void) => {
        stderrHandlers.push(cb)
      },
    },
    on: vi.fn(),
  }
  return {
    logger,
    child,
    stdoutHandlers,
    stderrHandlers,
    statusCb: null as ((src: Record<string, unknown>) => void) | null,
    statusGet: null as (() => unknown) | null,
    reconnectCb: null as (() => Promise<void>) | null,
    onEngineRunningCb: null as (() => boolean) | null,
    waitForPipeConnection: vi.fn(),
    sendWithFallback: vi.fn(),
    sendPipeCommand: vi.fn(),
    execFile: vi.fn(),
    configObj: {
      selectedAudioSessions: [] as number[],
      outputDirectory: '',
    },
  }
})

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => h.execFile(...args),
  spawn: vi.fn(() => h.child),
}))
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))
vi.mock('../services/logger.service', () => ({ getLogger: () => h.logger }))
vi.mock('../services/clips-config-manager', () => ({
  buildEngineConfig: vi.fn(() => ({ Hotkeys: [] })),
  config: h.configObj,
}))
vi.mock('./clips-pipe', () => ({
  connectPipe: vi.fn(),
  disconnectPipe: vi.fn(),
  isPipeConnected: vi.fn(() => false),
  sendPipeCommand: (...args: unknown[]) => h.sendPipeCommand(...args),
  sendWithFallback: (...args: unknown[]) => h.sendWithFallback(...args),
  setOnEngineRunning: vi.fn((cb: () => boolean) => {
    h.onEngineRunningCb = cb
  }),
  setOnReconnect: vi.fn((cb: () => Promise<void>) => {
    h.reconnectCb = cb
  }),
  setStatusCallbacks: vi.fn((cb: (src: Record<string, unknown>) => void, getter: () => unknown) => {
    h.statusCb = cb
    h.statusGet = getter
  }),
  waitForPipeConnection: (...args: unknown[]) => h.waitForPipeConnection(...args),
}))

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  classifyEngineLines,
  engineLogPrefix,
  getEnginePath,
  initEnginePipeIntegration,
  isEngineRunning,
  readEngineStatus,
  registerGetCurrentStatus,
  startEngine,
  stopEngineProcess,
} from './clips-engine'

const ORIG_ENV = { ...process.env }

function setPackaged(value: boolean): void {
  Object.defineProperty(app, 'isPackaged', { value, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.stdoutHandlers.length = 0
  h.stderrHandlers.length = 0
  h.statusCb = null
  h.statusGet = null
  h.reconnectCb = null
  h.onEngineRunningCb = null
  h.configObj.selectedAudioSessions = []
  h.configObj.outputDirectory = ''
  h.waitForPipeConnection.mockResolvedValue(true)
  h.sendWithFallback.mockResolvedValue(undefined)
  h.sendPipeCommand.mockResolvedValue(undefined)
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
  setPackaged(false)
})

describe('engine log severity routing', () => {
  // O engine C# escreve TODOS os níveis em stderr (ConsoleLogger.cs:16, writer padrão
  // = Console.Error) e codifica o nível no próprio texto: "HH:mm:ss.fff [Info   ] [..]".
  // O código anterior prefixava stderr inteiro como [ENGINE:ERR] e logava tudo como
  // `warning`, então uma linha [Info] chegava ao log do app como erro — o log de produção
  // mostrou "[ENGINE:ERR] [Info] [HotkeyManager] UpdateBindings" e "[ENGINE:ERR]
  // [Debug] [AudioDiag] ...", deixando o canal de erro inutilizável para triagem.

  it('honors the level the engine encoded in each line of a multi-line chunk', () => {
    const chunk = [
      '00:04:45.104 [Info   ] [HotkeyManager] UpdateBindings: 2 bindings',
      '00:04:50.232 [Error  ] [ffmpeg-aac-stderr] Guessed Channel Layout: stereo',
      '00:04:50.665 [Debug  ] [AudioDiag] packet #100 pts=5,590s',
      '00:04:52.244 [Warning] [Pipeline] Frame dropped - drop #1',
    ].join('\n')

    expect(classifyEngineLines(chunk, 'error').map((l) => l.level)).toEqual(['info', 'error', 'debug', 'warning'])
  })

  it('never reports an Info or Debug line as an error or warning', () => {
    const lines = classifyEngineLines(
      '00:04:45.104 [Info   ] [HotkeyManager] UpdateBindings\n00:04:50.665 [Debug  ] [AudioDiag] packet',
      'error',
    )
    expect(lines.map((l) => l.level)).toEqual(['info', 'debug'])
    for (const line of lines) {
      expect(line.level === 'error' || line.level === 'warning').toBe(false)
    }
  })

  it('parses the level without a timestamp, as writeTimestamps:false emits', () => {
    const [line] = classifyEngineLines('[Warning] [WDA] excluding failed', 'error')
    expect(line?.level).toBe('warning')
  })

  it('falls back to the stream default only when the level is unparseable', () => {
    // stderr é o canal de erro por convenção do engine, então o fallback é conservador de
    // propósito: rebaixar para info esconderia erro real. Fragmento de linha partida pelo
    // pipe também cai aqui — é o comportamento anterior, não uma regressão.
    expect(classifyEngineLines('use=4ms (+0ms)', 'error')[0]?.level).toBe('error')
    // stdout é o canal de dados (saída dos probes), então o fallback é info.
    expect(classifyEngineLines('bitrate = 21100 kbit/s', 'info')[0]?.level).toBe('info')
  })

  it('drops blank lines and trims padding around the line', () => {
    const lines = classifyEngineLines('  \n00:04:45.104 [Info   ] [X] y  \n\n', 'error')
    expect(lines).toEqual([{ level: 'info', text: '00:04:45.104 [Info   ] [X] y' }])
  })

  it('gives each level a distinct terminal prefix', () => {
    const prefixes = (['debug', 'info', 'warning', 'error'] as const).map(engineLogPrefix)
    expect(new Set(prefixes).size).toBe(4)
    expect(prefixes).toContain('[ENGINE:ERR]')
  })
})

describe('getEnginePath', () => {
  it('falls back when USERPROFILE is unset and no candidate exists', () => {
    delete process.env.USERPROFILE
    delete process.env.DINHO_CLIPS_ENGINE_PATH
    vi.mocked(existsSync).mockReturnValue(false)

    const result = getEnginePath()

    expect(typeof result).toBe('string')
    expect(result.endsWith('DiNho.Capture.Poc.exe')).toBe(true)
  })

  it('classifies candidates with the desktop ternary when USERPROFILE is set', () => {
    process.env.USERPROFILE = 'C:\\Users\\Tester'
    delete process.env.DINHO_CLIPS_ENGINE_PATH
    vi.mocked(existsSync).mockImplementation((p) => p.toString().includes('clips-engine'))

    const result = getEnginePath()

    expect(result).toContain('clips-engine')
  })

  // `npm run dev` NÃO constrói o C#: o resolver apontava para bin/Debug, que fica com o
  // build de quando alguém rodou `dotnet build` por último. Um smoke test de 10h rodou o
  // engine de 2 dias atrás — as três strings novas de log nunca apareceram. Em dev o
  // engine tem que vir do staging, que `npm run copy-engine` publica fresco e é
  // exatamente o que entra no instalador.

  it('prefers the staged engine in dev over the stale bin/Debug build', () => {
    process.env.USERPROFILE = 'C:\\Users\\Tester'
    delete process.env.DINHO_CLIPS_ENGINE_PATH
    setPackaged(false)
    vi.mocked(existsSync).mockReturnValue(true)

    const result = getEnginePath()

    expect(result).toContain(join('resources', 'clips-engine-staging'))
    expect(result).not.toContain(join('bin', 'Debug'))
  })

  it('falls back to the bin/Debug build in dev when staging is missing', () => {
    process.env.USERPROFILE = 'C:\\Users\\Tester'
    delete process.env.DINHO_CLIPS_ENGINE_PATH
    setPackaged(false)
    vi.mocked(existsSync).mockImplementation((p) => !p.toString().includes('clips-engine-staging'))

    const result = getEnginePath()

    expect(result).toContain(join('bin', 'Debug'))
  })

  it('never picks the dev staging engine when packaged', () => {
    process.env.USERPROFILE = 'C:\\Users\\Tester'
    delete process.env.DINHO_CLIPS_ENGINE_PATH
    setPackaged(true)
    vi.mocked(existsSync).mockReturnValue(true)

    const result = getEnginePath()

    expect(result).not.toContain('clips-engine-staging')
    expect(result).toContain(join('bin', 'Release'))
  })

  it('lets DINHO_CLIPS_ENGINE_PATH win over staging so an IDE can drive bin/Debug', () => {
    process.env.USERPROFILE = 'C:\\Users\\Tester'
    process.env.DINHO_CLIPS_ENGINE_PATH = 'D:\\eng\\DiNho.Capture.Poc.exe'
    vi.mocked(existsSync).mockReturnValue(true)

    expect(getEnginePath()).toBe('D:\\eng\\DiNho.Capture.Poc.exe')
  })
})

describe('statusUpdater via initEnginePipeIntegration', () => {
  beforeEach(() => {
    initEnginePipeIntegration()
  })

  it('clears the current game for null and undefined payloads', () => {
    h.statusCb!({ game: 'FiveM' })
    expect(readEngineStatus().currentGame).toBe('FiveM')

    h.statusCb!({ game: null })
    expect(readEngineStatus().currentGame).toBe('')

    h.statusCb!({ game: 'FiveM' })
    h.statusCb!({ game: undefined })
    expect(readEngineStatus().currentGame).toBe('')

    h.statusCb!({ game: 123 })
    expect(readEngineStatus().currentGame).toBe('')
  })

  it('warns and adopts the engine output directory when it differs', () => {
    h.configObj.outputDirectory = 'C:\\frontend\\clips'
    h.statusCb!({ outputDirectory: 'C:\\engine\\clips' })

    expect(h.logger.warning).toHaveBeenCalledWith('clips', expect.stringContaining('Output directory mismatch'))
    expect(h.configObj.outputDirectory).toBe('C:\\engine\\clips')

    h.configObj.outputDirectory = 'C:\\engine\\clips'
    h.statusCb!({ outputDirectory: 'C:\\engine\\clips' })
    expect(h.logger.warning).toHaveBeenCalledTimes(1)
  })

  it('throws from the status getter until one is registered', () => {
    expect(() => h.statusGet!()).toThrow('getCurrentStatus not registered')

    registerGetCurrentStatus(() => ({ running: true }) as never)
    expect(h.statusGet!()).toEqual({ running: true })
  })

  it('exposes the engine running flag to the pipe layer', () => {
    expect(h.onEngineRunningCb!()).toBe(false)
  })

  it('forgets the codec when the engine stops, so the editor falls back to software', () => {
    // O contrato de `ClipsEngineStatus.codec` diz: "Ausente = o engine não rodou ainda ou
    // parou, e o editor de clipes cai em software". O statusUpdater zera o `currentGame` no
    // null/undefined (teste acima) por exatamente esse motivo, mas o `stopEngineProcess`
    // limpava `_engineRunning`/`_engineCapturing`/`_engineProcess` e **deixava o
    // `_engineCodec`**: o status continuava anunciando um codec de um engine que já morreu.
    //
    // O Item 8 usa esse campo para decidir o encoder do trim/merge, então o valor velho
    // mandava o editor para o caminho de hardware (nvenc/amf) com o engine parado — que
    // funciona na maior parte das máquinas e falha na primeira em que o HW não bate com o
    // que foi detectado antes (driver trocado, GPU desativada, engine caiu e voltou como
    // software). O fallback em `libx264` é o comportamento anterior e o seguro.
    h.statusCb!({ codec: 'h264_nvenc' })
    expect(readEngineStatus().codec).toBe('h264_nvenc')

    stopEngineProcess()

    expect(readEngineStatus().codec).toBe('')
  })
})

describe('startEngine', () => {
  // `_engineRunning` é estado de módulo e o startEngine faz early-return quando já está
  // true, então sem isto o segundo teste deste describe não registraria os handlers.
  beforeEach(() => {
    stopEngineProcess()
  })

  it('logs engine output and warns when initial config sync fails', async () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    h.sendWithFallback.mockRejectedValue(new Error('pipe down'))
    h.sendPipeCommand.mockRejectedValue(new Error('audio down'))
    h.configObj.selectedAudioSessions = [111]

    await startEngine()

    expect(isEngineRunning()).toBe(true)
    expect(h.stdoutHandlers).toHaveLength(1)
    expect(h.stderrHandlers).toHaveLength(1)

    h.stdoutHandlers[0]!(Buffer.from('  engine up  '))
    h.stdoutHandlers[0]!(Buffer.from('   '))
    h.stderrHandlers[0]!(Buffer.from('warning text'))
    h.stderrHandlers[0]!(Buffer.from(''))

    expect(h.logger.info).toHaveBeenCalledWith('clips-engine', 'engine up')
    // "warning text" não tem nível parseável, e stderr cai em 'error' por convenção do
    // engine. A expectativa antiga era `warning` porque o handler logava stderr inteiro
    // como warning — ela fixava o bug, não um comportamento.
    expect(h.logger.error).toHaveBeenCalledWith('clips-engine', 'warning text')

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(h.logger.warning).toHaveBeenCalledWith('clips', 'Initial config sync to engine failed')
    expect(h.logger.warning).toHaveBeenCalledWith('clips', 'Initial audio session sync to engine failed')

    stdoutWrite.mockRestore()
  })

  it('routes an engine Info line on stderr to the info severity, not to warning or error', async () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await startEngine()

    h.stderrHandlers[0]!(Buffer.from('00:04:45.104 [Info   ] [EngineCoordinator] Pronto. Aguardando hotkeys...'))

    expect(h.logger.info).toHaveBeenCalledWith(
      'clips-engine',
      '00:04:45.104 [Info   ] [EngineCoordinator] Pronto. Aguardando hotkeys...',
    )
    // A regressão exata do log de produção: Info chegando como warning/erro.
    expect(h.logger.warning).not.toHaveBeenCalledWith('clips-engine', expect.anything())
    expect(h.logger.error).not.toHaveBeenCalledWith('clips-engine', expect.anything())

    stdoutWrite.mockRestore()
  })
})
