// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const mockGetAudioSessions = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/lib/app-version', () => ({ APP_VERSION: '2.0.9' }))

vi.mock('framer-motion', async () => (await import('../../../test-motion-mock')).motionMock)

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  const icons = [
    'Activity',
    'AppWindow',
    'ChevronDown',
    'CircleStop',
    'Clapperboard',
    'Combine',
    'Cpu',
    'Disc',
    'Download',
    'EllipsisVertical',
    'Film',
    'FolderOpen',
    'Gamepad2',
    'Gauge',
    'HardDrive',
    'Mic',
    'Microscope',
    'Monitor',
    'Pencil',
    'Plus',
    'Power',
    'PowerOff',
    'RefreshCw',
    'Search',
    'Settings',
    'ShieldAlert',
    'Sparkles',
    'Star',
    'Trash2',
    'TriangleAlert',
    'Upload',
    'Video',
    'X',
  ]
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
  clipsGetAudioSessions: mockGetAudioSessions,
  clipsOnEngineStatus: mockOnEngineStatus,
  clipsGetVideoUrl: (path: string) => `clip-video://file?path=${encodeURIComponent(path)}`,
} as Record<string, unknown> as typeof window.dinho

import { ClipsPage } from './ClipsPage'

const baseConfig = {
  replayTimeSeconds: 120,
  micEnabled: true,
  audioLoopback: false,
  fps: 30,
  width: 1920,
  height: 1080,
  bitrateKbps: 50000,
  cq: 22,
  maxrateKbps: 30000,
  bufsizeKbps: 60000,
  bframes: 2,
  lookahead: 16,
  encoderPreset: 'p4',
  outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
  forceSoftware: false,
  pushToTalk: 'off',
  pushToTalkKeys: [0x7a],
  gameDetection: false,
  hotkeys: [
    { id: 'hk-save', vk: 0x77, modifiers: [], action: 'saveClip', replayDurationSeconds: 60, enabled: true },
    { id: 'hk-capture', vk: 0x78, modifiers: [], action: 'screenshot', enabled: true },
    { id: 'hk-mic', vk: 0x79, modifiers: [], action: 'toggleMic', enabled: true },
  ],
}

describe('ClipsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockGetStatus.mockResolvedValue({
      running: false,
      capturing: false,
      uptime: 0,
      fps: 30,
      replayTimeSeconds: 120,
    })
    mockGetConfig.mockResolvedValue({ ...baseConfig })
    mockList.mockResolvedValue([])
    mockGetAudioSessions.mockResolvedValue([])
  })

  const showSettings = () => {
    const btn = screen.getByTitle('showSettings')
    fireEvent.click(btn)
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
      fps: 30,
      replayTimeSeconds: 120,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('idle')).toBeTruthy()
  })

  it('displays recording state when capturing', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
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
      fps: 30,
      replayTimeSeconds: 120,
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

  it('handles missing window.dinho gracefully', async () => {
    const savedDinho = window.dinho
    delete (window as any).dinho
    expect(() => render(<ClipsPage />)).not.toThrow()
    // Mount effects still run with window.dinho undefined; drain them inside
    // act (macrotask hop, since act only flushes microtasks) so the resulting
    // setState calls are not act() warnings.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    ;(window as any).dinho = savedDinho
  })

  it('shows expanded engine status fields when provided', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 300,
      fps: 30,
      replayTimeSeconds: 120,
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
    expect(screen.getByText('512megabytes')).toBeTruthy()
    expect(screen.getByText('Cyberpunk 2077')).toBeTruthy()
    expect(screen.getByText('crashRecovered')).toBeTruthy()
  })

  it('shows desktop capture mode badge when no game is detected', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 60,
      fps: 60,
      replayTimeSeconds: 120,
      captureMode: 'desktop',
    })
    render(<ClipsPage />)
    expect(await screen.findByText('captureModeDesktop')).toBeTruthy()
  })

  it('shows window capture mode badge for a non-game window', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 60,
      fps: 60,
      replayTimeSeconds: 120,
      captureMode: 'window',
    })
    render(<ClipsPage />)
    expect(await screen.findByText('captureModeWindow')).toBeTruthy()
  })

  it('shows low disk warning in status badges when diskSpaceOk is false', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: false,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
      diskSpaceOk: false,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('lowDisk')).toBeTruthy()
  })

  it('calls setConfig when game detection toggle is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    const gdToggle = screen.getAllByText('gameDetection')[1]!.parentElement!.querySelector('button')!
    await act(async () => {
      fireEvent.click(gdToggle)
    })
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
    await act(async () => {
      fireEvent.click(alToggle)
    })
    expect(mockSetConfig).toHaveBeenCalledWith({ audioLoopback: true, gameAudioOnly: false })
  })

  it('toggling loopback off restores gameAudioOnly', async () => {
    const store: Record<string, unknown> = {
      replayTimeSeconds: 120,
      micEnabled: true,
      gameAudioOnly: true,
      audioLoopback: false,
      fps: 30,
      width: 1920,
      height: 1080,
      bitrateKbps: 50000,
      cq: 22,
      maxrateKbps: 30000,
      bufsizeKbps: 60000,
      bframes: 2,
      lookahead: 16,
      encoderPreset: 'p4',
      outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
      forceSoftware: false,
      pushToTalk: 'off',
      pushToTalkKeys: [0x7a],
      gameDetection: false,
      hotkeys: [],
    }
    mockGetConfig.mockImplementation(async () => store)
    mockSetConfig.mockImplementation(async (partial: Record<string, unknown>) => Object.assign(store, partial))
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    fireEvent.click(screen.getByText('audioLoopback'))
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledWith({ audioLoopback: true, gameAudioOnly: false }))
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalledTimes(2))
    mockSetConfig.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByText('audioLoopback'))
    })
    expect(mockSetConfig).toHaveBeenCalledWith({ audioLoopback: false, gameAudioOnly: true })
  })

  it('turning gameAudioOnly off enables full system loopback', async () => {
    const store: Record<string, unknown> = {
      replayTimeSeconds: 120,
      micEnabled: true,
      gameAudioOnly: false,
      audioLoopback: true,
      fps: 30,
      width: 1920,
      height: 1080,
      bitrateKbps: 50000,
      cq: 22,
      maxrateKbps: 30000,
      bufsizeKbps: 60000,
      bframes: 2,
      lookahead: 16,
      encoderPreset: 'p4',
      outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
      forceSoftware: false,
      pushToTalk: 'off',
      pushToTalkKeys: [0x7a],
      gameDetection: false,
      hotkeys: [],
    }
    mockGetConfig.mockImplementation(async () => store)
    mockSetConfig.mockImplementation(async (partial: Record<string, unknown>) => Object.assign(store, partial))
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    fireEvent.click(screen.getByTestId('gameAudioOnly-toggle'))
    await waitFor(() =>
      expect(mockSetConfig).toHaveBeenCalledWith({ gameAudioOnly: true, micEnabled: true, audioLoopback: false }),
    )
    await waitFor(() => expect(mockGetConfig).toHaveBeenCalledTimes(2))
    mockSetConfig.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByTestId('gameAudioOnly-toggle'))
    })
    expect(mockSetConfig).toHaveBeenCalledWith({ gameAudioOnly: false, audioLoopback: true })
  })

  it('renders audio sessions picker and includes an app session', async () => {
    mockGetAudioSessions.mockResolvedValue([
      { processId: 4421, processName: 'FiveM_b2944.exe', displayName: 'Grand Theft Auto V', isSelected: true },
      { processId: 2233, processName: 'Spotify.exe', displayName: 'Spotify', isSelected: false },
    ])
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    await act(async () => {
      fireEvent.click(screen.getByText('audioSessions'))
    })
    expect(await screen.findByText('Spotify')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-session-2233'))
    })
    expect(mockSetConfig).toHaveBeenLastCalledWith({ selectedAudioSessions: [2233] })
  })

  it('audio sessions picker does not show the always-included badge nor pre-selects engine sessions', async () => {
    mockGetConfig.mockResolvedValue({ ...baseConfig, selectedAudioSessions: [] })
    mockGetAudioSessions.mockResolvedValue([
      { processId: 4421, processName: 'FiveM_b2944.exe', displayName: 'Grand Theft Auto V', isSelected: true },
      { processId: 2233, processName: 'Spotify.exe', displayName: 'Spotify', isSelected: true },
    ])
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    await act(async () => {
      fireEvent.click(screen.getByText('audioSessions'))
    })
    expect(await screen.findByText('Spotify')).toBeTruthy()
    expect(screen.getByText('audioSessionsHint')).toBeTruthy()
    expect(screen.queryByText('requiredSession')).toBeNull()
    expect(screen.getAllByText('sessionInclude')).toHaveLength(2)
  })

  it('audio sessions picker is single-select: including a new app replaces the previous selection', async () => {
    mockGetConfig.mockResolvedValue({ ...baseConfig, selectedAudioSessions: [2233] })
    mockGetAudioSessions.mockResolvedValue([
      { processId: 2233, processName: 'Spotify.exe', displayName: 'Spotify', isSelected: true },
      { processId: 7788, processName: 'Discord.exe', displayName: 'Discord', isSelected: true },
    ])
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    await act(async () => {
      fireEvent.click(screen.getByText('audioSessions'))
    })
    expect(await screen.findByText('Discord')).toBeTruthy()
    expect(screen.getByText('sessionRemove')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-session-7788'))
    })
    expect(mockSetConfig).toHaveBeenLastCalledWith({ selectedAudioSessions: [7788] })
  })

  it('removing the selected app restores full system capture', async () => {
    mockGetConfig.mockResolvedValue({ ...baseConfig, selectedAudioSessions: [2233] })
    mockGetAudioSessions.mockResolvedValue([
      { processId: 2233, processName: 'Spotify.exe', displayName: 'Spotify', isSelected: true },
    ])
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    await act(async () => {
      fireEvent.click(screen.getByText('audioSessions'))
    })
    expect(await screen.findByText('Spotify')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByTestId('audio-session-2233'))
    })
    expect(mockSetConfig).toHaveBeenLastCalledWith({ selectedAudioSessions: [] })
  })

  it('shows a news badge on the settings gear after an update, cleared on click', async () => {
    localStorage.setItem('dinho-clips-new-version', '2.0.8')
    render(<ClipsPage />)
    await screen.findByText('pageTitle')
    expect(await screen.findByTestId('clips-news-badge')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByTitle('showSettings'))
    })
    await screen.findByText('recordingQuality')
    expect(screen.queryByTestId('clips-news-badge')).toBeNull()
  })

  it('shows a "configure here" speech bubble next to the gear after an update', async () => {
    localStorage.setItem('dinho-clips-new-version', '2.0.8')
    render(<ClipsPage />)
    await screen.findByText('pageTitle')
    expect(await screen.findByText('configureClipsHint')).toBeTruthy()
  })

  it('hides the configure hint once the settings panel is open', async () => {
    localStorage.setItem('dinho-clips-new-version', '2.0.8')
    render(<ClipsPage />)
    await screen.findByText('pageTitle')
    await act(async () => {
      fireEvent.click(screen.getByTitle('showSettings'))
    })
    await screen.findByText('recordingQuality')
    expect(screen.queryByText('configureClipsHint')).toBeNull()
  })

  it('does not show the news badge when the version was already seen', async () => {
    localStorage.setItem('dinho-clips-new-version', '2.0.9')
    render(<ClipsPage />)
    await screen.findByText('pageTitle')
    expect(screen.queryByTestId('clips-news-badge')).toBeNull()
  })

  it('lets the user dismiss the configure hint without opening settings', async () => {
    localStorage.setItem('dinho-clips-new-version', '2.0.8')
    render(<ClipsPage />)
    await screen.findByText('pageTitle')
    expect(await screen.findByTestId('clips-news-badge')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByLabelText('close'))
    })
    expect(screen.queryByTestId('clips-news-badge')).toBeNull()
    expect(screen.getByTitle('showSettings')).toBeTruthy()
    expect(localStorage.getItem('dinho-clips-new-version')).toBe('2.0.9')
  })

  it('renders game detection toggle', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.getAllByText('gameDetection')[1]).toBeTruthy()
  })

  it('offers the screenshot hotkey action and no longer offers capture (PTT stays)', async () => {
    mockGetConfig.mockResolvedValue({
      replayTimeSeconds: 120,
      micEnabled: true,
      audioLoopback: false,
      fps: 30,
      width: 1920,
      height: 1080,
      bitrateKbps: 50000,
      cq: 22,
      maxrateKbps: 30000,
      bufsizeKbps: 60000,
      bframes: 2,
      lookahead: 16,
      encoderPreset: 'p4',
      outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
      forceSoftware: false,
      pushToTalk: 'off',
      pushToTalkKeys: [0x7a],
      gameDetection: false,
      hotkeys: [{ id: 'hk-shot', vk: 0x7b, modifiers: [], action: 'screenshot', enabled: true }],
    })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    await act(async () => {
      fireEvent.click(screen.getByText('hotkeys'))
    })
    expect(await screen.findByText('actionScreenshotLabel')).toBeTruthy()
    expect(screen.queryByText('actionToggleCaptureLabel')).toBeNull()
    // pushToTalk was removed from the action select (engine never supported it as a hotkey action)
    expect(screen.queryByText('actionPushToTalkLabel')).toBeNull()
  })

  it('still offers the Push-to-Talk section in the audio settings', async () => {
    render(<ClipsPage />)
    showSettings()
    expect(await screen.findByText('pushToTalk')).toBeTruthy()
  })

  it('turns Push-to-Talk on (hold) from the single switch', async () => {
    const store: Record<string, unknown> = { ...baseConfig, pushToTalk: 'off' }
    mockGetConfig.mockImplementation(async () => store)
    mockSetConfig.mockImplementation(async (partial: Record<string, unknown>) => Object.assign(store, partial))
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('pushToTalk')
    fireEvent.click(screen.getByText('pushToTalk'))
    fireEvent.click(screen.getByTestId('pushToTalk-toggle'))
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledWith({ pushToTalk: 'hold' }))
  })

  it('turns Push-to-Talk back off from the single switch', async () => {
    const store: Record<string, unknown> = { ...baseConfig, pushToTalk: 'hold' }
    mockGetConfig.mockImplementation(async () => store)
    mockSetConfig.mockImplementation(async (partial: Record<string, unknown>) => Object.assign(store, partial))
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('pushToTalk')
    fireEvent.click(screen.getByText('pushToTalk'))
    fireEvent.click(screen.getByTestId('pushToTalk-toggle'))
    await waitFor(() => expect(mockSetConfig).toHaveBeenCalledWith({ pushToTalk: 'off' }))
  })

  it('renders quality presets', async () => {
    render(<ClipsPage />)
    showSettings()
    expect(await screen.findByText('recordingQuality')).toBeTruthy()
    expect(screen.getByText('presetDeus')).toBeTruthy()
    expect(screen.getByText('presetAlta')).toBeTruthy()
    expect(screen.getByText('presetLeve')).toBeTruthy()
    expect(screen.getByText('presetBatata')).toBeTruthy()
  })

  it('calls setConfig when quality preset is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    await act(async () => {
      fireEvent.click(screen.getByText('presetAlta'))
    })
    expect(mockSetConfig).toHaveBeenCalledWith(expect.objectContaining({ cq: 18, maxrateKbps: 55000 }))
  })

  it('calls setConfig with low-end values when performance preset is clicked', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    await act(async () => {
      fireEvent.click(screen.getByText('presetBatata'))
    })
    expect(mockSetConfig).toHaveBeenCalledWith(
      expect.objectContaining({ cq: 22, maxrateKbps: 12000, width: 1280, height: 720, fps: 30 }),
    )
  })

  it('switches replay buffer mode to disk via 3-way selector', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('replayBufferMode')
    expect(screen.getByText('replayBufferModeRam')).toBeTruthy()
    expect(screen.getByText('replayBufferModeHybrid')).toBeTruthy()
    expect(screen.getByText('replayBufferModeDisk')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByText('replayBufferModeDisk'))
    })
    expect(mockSetConfig).toHaveBeenCalledWith(expect.objectContaining({ replayBufferMode: 'disk' }))
  })

  it('no longer offers adaptive quality in the UI (feature removed from UI)', async () => {
    mockGetConfig.mockResolvedValue({ ...baseConfig, adaptiveQuality: true })
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
      calibrationTier: 'Strong',
    })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.queryByText('adaptiveQuality')).toBeNull()
  })

  it('no longer offers the 480p resolution option', async () => {
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.queryByText('480p')).toBeNull()
    expect(screen.getByText('720p')).toBeTruthy()
    expect(screen.getByText('1080p')).toBeTruthy()
  })

  it('does not show a dropped frames badge even when drop counters are non-zero', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      capturing: true,
      uptime: 120,
      fps: 30,
      replayTimeSeconds: 120,
      droppedFrames: 7,
      gpuBusyDrops: 3,
    })
    render(<ClipsPage />)
    expect(await screen.findByText('recording')).toBeTruthy()
    expect(screen.queryByText(/droppedFrames/)).toBeNull()
    expect(screen.queryByText(/GPU: 3/)).toBeNull()
  })

  it('calls setConfig with 150 when selecting custom replay time from a preset', async () => {
    mockGetConfig.mockResolvedValue({
      replayTimeSeconds: 30,
      micEnabled: true,
      audioLoopback: false,
      fps: 30,
      width: 1920,
      height: 1080,
      bitrateKbps: 50000,
      cq: 22,
      maxrateKbps: 30000,
      bufsizeKbps: 60000,
      bframes: 2,
      lookahead: 16,
      encoderPreset: 'p4',
      outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
      forceSoftware: false,
      pushToTalk: 'off',
      pushToTalkKeys: [0x7a],
      gameDetection: false,
      hotkeys: [],
    })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    await act(async () => {
      fireEvent.click(screen.getByText('replayCustom'))
    })
    expect(mockSetConfig).toHaveBeenCalledWith({ replayTimeSeconds: 150 })
  })

  it('calls setConfig with preset value when selecting preset replay time from custom', async () => {
    mockGetConfig.mockResolvedValue({
      replayTimeSeconds: 150,
      micEnabled: true,
      audioLoopback: false,
      fps: 30,
      width: 1920,
      height: 1080,
      bitrateKbps: 50000,
      cq: 22,
      maxrateKbps: 30000,
      bufsizeKbps: 60000,
      bframes: 2,
      lookahead: 16,
      encoderPreset: 'p4',
      outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
      forceSoftware: false,
      pushToTalk: 'off',
      pushToTalkKeys: [0x7a],
      gameDetection: false,
      hotkeys: [],
    })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    await act(async () => {
      fireEvent.click(screen.getByText('replayPreset30s'))
    })
    expect(mockSetConfig).toHaveBeenCalledWith({ replayTimeSeconds: 30 })
  })

  it('keeps current custom replay value when clicking custom again from custom', async () => {
    mockGetConfig.mockResolvedValue({
      replayTimeSeconds: 150,
      micEnabled: true,
      audioLoopback: false,
      fps: 30,
      width: 1920,
      height: 1080,
      bitrateKbps: 50000,
      cq: 22,
      maxrateKbps: 30000,
      bufsizeKbps: 60000,
      bframes: 2,
      lookahead: 16,
      encoderPreset: 'p4',
      outputDirectory: 'C:\\Users\\Test\\Desktop\\DiNhoClips',
      forceSoftware: false,
      pushToTalk: 'off',
      pushToTalkKeys: [0x7a],
      gameDetection: false,
      hotkeys: [],
    })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    await act(async () => {
      fireEvent.click(screen.getByText('replayCustom'))
    })
    expect(mockSetConfig).toHaveBeenCalledWith({ replayTimeSeconds: 150 })
  })

  it('shows the RAM warning at 5+ minutes in RAM buffer mode', async () => {
    mockGetConfig.mockResolvedValue({ ...baseConfig, replayTimeSeconds: 300, replayBufferMode: 'ram' })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.getByText('replayRamWarning')).toBeTruthy()
  })

  it('shows the RAM warning at 5+ minutes in hybrid buffer mode', async () => {
    mockGetConfig.mockResolvedValue({ ...baseConfig, replayTimeSeconds: 300, replayBufferMode: 'hybrid' })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.getByText('replayRamWarning')).toBeTruthy()
  })

  it('does not show the RAM warning in disk-only buffer mode', async () => {
    mockGetConfig.mockResolvedValue({ ...baseConfig, replayTimeSeconds: 300, replayBufferMode: 'disk' })
    render(<ClipsPage />)
    showSettings()
    await screen.findByText('recordingQuality')
    expect(screen.queryByText('replayRamWarning')).toBeNull()
  })

  describe('grade de presets de qualidade (item 6)', () => {
    it('oferece cinco degraus, incluindo 900p entre Boa e Leve', async () => {
      render(<ClipsPage />)
      showSettings()
      await screen.findByText('presetBoa')
      expect(screen.getByText('presetDeus')).toBeTruthy()
      expect(screen.getByText('presetAlta')).toBeTruthy()
      expect(screen.getByText('presetBoa')).toBeTruthy()
      expect(screen.getByText('presetLeve')).toBeTruthy()
      expect(screen.getByText('presetBatata')).toBeTruthy()
    })

    it('mostra os presets na ordem Deus, Alta, Boa, Leve, Batata', async () => {
      render(<ClipsPage />)
      showSettings()
      await screen.findByText('presetBoa')
      // A ordem é escada de custo decrescente; se alguém reordenar o array sem querer,
      // o botão mais caro passa a vir depois do mais barato. O textContent carrega nome +
      // rótulo derivado, então a comparação inclui os dois.
      const botoes = screen
        .getAllByRole('button')
        .map((b) => b.textContent ?? '')
        .filter((t) => t.startsWith('preset'))
      expect(botoes).toEqual([
        'presetDeusCQ 16 · 1080p',
        'presetAltaCQ 18 · 1080p',
        'presetBoaCQ 20 · 900p',
        'presetLeveCQ 20 · 720p',
        'presetBatataCQ 22 · 720p30',
      ])
    })

    it('cada botão descreve o preset que ele realmente aplica (rótulo derivado, não digitado)', async () => {
      render(<ClipsPage />)
      showSettings()
      await screen.findByText('presetBoa')
      // Se alguém trocar a resolução de um preset sem mexer no texto, esta trava quebra.
      expect(screen.getByText('CQ 16 · 1080p')).toBeTruthy()
      expect(screen.getByText('CQ 18 · 1080p')).toBeTruthy()
      expect(screen.getByText('CQ 20 · 720p')).toBeTruthy()
      expect(screen.getByText('CQ 20 · 900p')).toBeTruthy()
      expect(screen.getByText('CQ 22 · 720p30')).toBeTruthy()
    })

    it('o rótulo derivado fica embaixo do nome do degrau certo', async () => {
      render(<ClipsPage />)
      showSettings()
      await screen.findByText('presetBoa')
      const botao = screen.getByText('presetBoa').closest('button')
      // Boa é o degrau de 900p; Leve é o de 720p. Os nomes foram trocados depois que os
      // ids nasceram, então o par nome/resolução é o que precisa estar travado.
      expect(botao?.textContent).toBe('presetBoaCQ 20 · 900p')
      expect(screen.getByText('presetLeve').closest('button')?.textContent).toBe('presetLeveCQ 20 · 720p')
    })

    it('aplicar o degrau de 900p manda 1600x900 com o CQ 20 do preset', async () => {
      render(<ClipsPage />)
      showSettings()
      await screen.findByText('presetBoa')
      fireEvent.click(screen.getByText('presetBoa'))
      await waitFor(() => {
        const call = mockSetConfig.mock.calls.at(-1)?.[0] as Record<string, unknown>
        expect(call.width).toBe(1600)
        expect(call.height).toBe(900)
        expect(call.cq).toBe(20)
        expect(call.fps).toBe(60)
      })
    })

    it('o seletor de resolução tem 900p', async () => {
      render(<ClipsPage />)
      showSettings()
      await screen.findByText('resolution')
      expect(screen.getByText('900p')).toBeTruthy()
    })

    it('escolher 900p no seletor manda 1600x900', async () => {
      render(<ClipsPage />)
      showSettings()
      await screen.findByText('900p')
      fireEvent.click(screen.getByText('900p'))
      await waitFor(() => {
        expect(mockSetConfig).toHaveBeenCalledWith({ width: 1600, height: 900 })
      })
    })
  })
})
