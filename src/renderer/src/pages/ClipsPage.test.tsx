// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetStatus = vi.fn()
const mockGetConfig = vi.fn()
const mockSetConfig = vi.fn()
const mockList = vi.fn()
const mockStartEngine = vi.fn()
const mockStopEngine = vi.fn()
const mockStartCapture = vi.fn()
const mockStopCapture = vi.fn()
const mockSaveClip = vi.fn()
const mockDeleteClip = vi.fn()
const mockOpenClip = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        // biome-ignore lint/suspicious/noExplicitAny: test
        ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
    // biome-ignore lint/suspicious/noExplicitAny: test
  ) as any,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  const icons = [
    'ChevronDown',
    'CircleStop',
    'Clapperboard',
    'Cpu',
    'Disc',
    'Download',
    'Film',
    'FolderOpen',
    'Gamepad2',
    'HardDrive',
    'Mic',
    'Microscope',
    'Plus',
    'Power',
    'PowerOff',
    'RefreshCw',
    'Search',
    'Settings',
    'Star',
    'Trash2',
    'Video',
    'X',
  ]
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  const iconMap: Record<string, any> = {}
  for (const name of icons) iconMap[name] = Icon
  return iconMap
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockOnEngineStatus = vi.fn(() => vi.fn())

window.dinho = {
  clipsGetStatus: mockGetStatus,
  clipsGetConfig: mockGetConfig,
  clipsSetConfig: mockSetConfig,
  clipsList: mockList,
  clipsStartEngine: mockStartEngine,
  clipsStopEngine: mockStopEngine,
  clipsStartCapture: mockStartCapture,
  clipsStopCapture: mockStopCapture,
  clipsSaveClip: mockSaveClip,
  clipsDelete: mockDeleteClip,
  clipsOpen: mockOpenClip,
  clipsOnEngineStatus: mockOnEngineStatus,
  clipsGetVideoUrl: (path: string) => `clip-video://file?path=${encodeURIComponent(path)}`,
} as Record<string, unknown> as typeof window.dinho

import { ClipsPage } from './ClipsPage'

describe('ClipsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockResolvedValue({
      running: false,
      capturing: false,
      uptime: 0,
      fps: 60,
      replayTimeSeconds: 60,
    })
    mockGetConfig.mockResolvedValue({
      replayTimeSeconds: 60,
      micEnabled: true,
      audioLoopback: false,
      fps: 60,
      width: 1920,
      height: 1080,
      bitrateKbps: 50000,
      cq: 24,
      maxrateKbps: 50000,
      bufsizeKbps: 100000,
      bframes: 2,
      lookahead: 4,
      encoderPreset: 'p4',
      outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
      forceSoftware: false,
      pushToTalk: 'off',
      pushToTalkKeys: [0x7a],
      gameDetection: false,
      hotkeys: [
        { id: 'hk-save', vk: 0x77, modifiers: [], action: 'saveClip', replayDurationSeconds: 60, enabled: true },
        { id: 'hk-capture', vk: 0x78, modifiers: [], action: 'toggleCapture', enabled: true },
        { id: 'hk-mic', vk: 0x79, modifiers: [], action: 'toggleMic', enabled: true },
      ],
    })
    mockList.mockResolvedValue([])
  })

  const showSettings = () => {
    const btn = screen.getByTitle('Settings')
    btn.click()
  }

  it('renders page header and engine status section', async () => {
    render(<ClipsPage />)
    expect(await screen.findByText('pageTitle')).toBeTruthy()
    expect(screen.getByText('pageDescription')).toBeTruthy()
    expect(screen.getByText('recordingStatus')).toBeTruthy()
  })

  it('displays stopped state when engine is not running', async () => {
    render(<ClipsPage />)
    expect(await screen.findByText('stopped')).toBeTruthy()
  })

  it('displays idle state when engine is running but not capturing', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: false,
      uptime: 120,
      fps: 60,
      replayTimeSeconds: 60,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('idle')).toBeTruthy()
  })

  it('displays recording state when capturing', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 120,
      fps: 60,
      replayTimeSeconds: 60,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('recording')).toBeTruthy()
  })

  it('shows start recording button when not running', async () => {
    render(<ClipsPage />)
    expect(await screen.findByText('startRecording')).toBeTruthy()
  })

  it('shows start recording button when engine is idle', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: false,
      uptime: 120,
      fps: 60,
      replayTimeSeconds: 60,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('startRecording')).toBeTruthy()
  })

  it('shows no clips message when list is empty', async () => {
    render(<ClipsPage />)
    expect(await screen.findByText('noClips')).toBeTruthy()
  })

  it('renders clip list when clips exist', async () => {
    mockList.mockResolvedValue([
      { name: 'clip1.mp4', path: 'C:\\clips\\clip1.mp4', size: 102400, createdAt: '2026-06-21T10:00:00Z', duration: 0 },
      { name: 'clip2.mp4', path: 'C:\\clips\\clip2.mp4', size: 204800, createdAt: '2026-06-20T10:00:00Z', duration: 0 },
    ])
    render(<ClipsPage />)
    expect(await screen.findByText('clip1.mp4')).toBeTruthy()
    expect(screen.getByText('clip2.mp4')).toBeTruthy()
    expect(screen.getByText('clipCount')).toBeTruthy()
  })

  it('calls clipsGetStatus and clipsList on mount', async () => {
    render(<ClipsPage />)
    await screen.findByText('pageTitle')
    expect(mockGetStatus).toHaveBeenCalled()
    expect(mockList).toHaveBeenCalled()
  })

  it('handles missing window.dinho gracefully', () => {
    const savedDinho = window.dinho
    // biome-ignore lint/suspicious/noExplicitAny: test - simulating missing API
    delete (window as any).dinho
    expect(() => render(<ClipsPage />)).not.toThrow()
    // biome-ignore lint/suspicious/noExplicitAny: test - restore
    ;(window as any).dinho = savedDinho
  })

  it('shows expanded engine status fields when provided', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 300,
      fps: 60,
      replayTimeSeconds: 60,
      captureBackend: 'nvenc',
      encoder: 'h264',
      replayBufferBytes: 536870912,
      diskSpaceOk: true,
      currentGame: 'Cyberpunk 2077',
      lastCrashRecovered: true,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('nvenc')).toBeTruthy()
    expect(screen.getByText('h264')).toBeTruthy()
    expect(screen.getByText('512MB')).toBeTruthy()
    expect(screen.getByText('Cyberpunk 2077')).toBeTruthy()
    expect(screen.getByText('crashRecovered')).toBeTruthy()
  })

  it('does not show low disk warning in status badges', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: false,
      uptime: 120,
      fps: 60,
      replayTimeSeconds: 60,
      diskSpaceOk: false,
    })
    render(<ClipsPage />)
    expect(screen.queryByText('lowDisk')).toBeNull()
  })

  it('renders push-to-talk mode selector', async () => {
    render(<ClipsPage />)
    showSettings()
    expect(await screen.findByText('recordingQuality')).toBeTruthy()
    screen.getByText('pushToTalk').click()
    expect(await screen.findByText('pttOff')).toBeTruthy()
    expect(screen.getByText('pttHold')).toBeTruthy()
    expect(screen.getByText('pttToggle')).toBeTruthy()
  })

  it('calls setConfig when PTT mode button is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    screen.getByText('pushToTalk').click()
    await screen.findByText('pttHold')
    screen.getByText('pttHold').click()
    expect(mockSetConfig).toHaveBeenCalledWith({ pushToTalk: 'hold' })
  })

  it('calls setConfig when game detection toggle is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    const gdToggle = screen.getAllByText('gameDetection')[1].parentElement!.querySelector('button')!
    gdToggle.click()
    expect(mockSetConfig).toHaveBeenCalledWith({ gameDetection: true })
  })

  it('renders audio loopback toggle', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.getByText('audioLoopback')).toBeTruthy()
  })

  it('calls setConfig when audio loopback toggle is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    const alToggle = screen.getByText('audioLoopback')
    alToggle.click()
    expect(mockSetConfig).toHaveBeenCalledWith({ audioLoopback: true, gameAudioOnly: false })
  })

  it('renders game detection toggle', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.getAllByText('gameDetection')[1]).toBeTruthy()
  })

  it('renders pushToTalk as a hotkey action option', async () => {
    mockGetConfig.mockResolvedValue({
      replayTimeSeconds: 60,
      micEnabled: true,
      audioLoopback: false,
      fps: 60,
      width: 1920,
      height: 1080,
      bitrateKbps: 50000,
      cq: 24,
      maxrateKbps: 50000,
      bufsizeKbps: 100000,
      bframes: 2,
      lookahead: 4,
      encoderPreset: 'p4',
      outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
      forceSoftware: false,
      pushToTalk: 'off',
      pushToTalkKeys: [0x7a],
      gameDetection: false,
      hotkeys: [{ id: 'hk-ptt', vk: 0x7b, modifiers: [], action: 'pushToTalk', enabled: true }],
    })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    screen.getByText('hotkeys').click()
    expect(await screen.findByText('PTT')).toBeTruthy()
  })

  it('renders quality presets', async () => {
    render(<ClipsPage />)
    showSettings()
    expect(await screen.findByText('recordingQuality')).toBeTruthy()
    expect(screen.getByText('Muito Alta')).toBeTruthy()
    expect(screen.getByText('Alta')).toBeTruthy()
    expect(screen.getByText('Boa')).toBeTruthy()
  })

  it('calls setConfig when quality preset is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    screen.getByText('Alta').click()
    expect(mockSetConfig).toHaveBeenCalledWith(
      expect.objectContaining({ cq: 20, maxrateKbps: 40000 })
    )
  })

  it('renders force software toggle', async () => {
    render(<ClipsPage />)
    showSettings()
    expect(await screen.findByText('forceSoftware')).toBeTruthy()
  })

  it('calls setConfig when force software toggle is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    const fsToggle = screen.getByText('forceSoftware').parentElement!.parentElement!.querySelector('button')!
    fsToggle.click()
    expect(mockSetConfig).toHaveBeenCalledWith({ forceSoftware: true })
  })
})
