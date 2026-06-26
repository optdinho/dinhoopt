using DiNho.Capture.Poc.Audio;
using DiNho.Capture.Poc.Buffer;
using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Config;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;
using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Hotkeys;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Status;
using DiNho.Capture.Poc.Sync;
using DiNho.Capture.Poc.Watchdog;
using System.Collections.Concurrent;
using DiNho.Capture.Poc.Logging;
using System.Linq;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc;

public sealed class EngineCoordinator : IDisposable
{
    // Módulos
    private readonly ConfigManager _config;
    private readonly MasterClock _clock;
    private readonly GameDetector _gameDetector;
    private readonly HotkeyManager _hotkeys;
    private readonly PushToTalkManager _ptt;
    private readonly ReplayBuffer _buffer;
    private readonly ClipExporter _exporter;
    private readonly NamedPipeServer _pipeServer;
    private readonly EngineStatus _status;
    private readonly AudioSessionManager _audioSessions;

    // Pipeline (criados no Start)
    private ICaptureSource? _capture;
    private IEncoder? _encoder;
    private FfmpegAacEncoder? _aacEncoder;
    private AudioMixer? _audioMixer;
    private IAudioSource? _loopbackSource;
    private IAudioSource? _micSource;

    // Estado
    private bool _recording;
    private string? _capturedGameProcess;
    private bool _captureActive;
    private bool _exportInProgress;
    private readonly object _exportLock = new();
    private readonly object _pipelineLock = new();
    private Timer? _cleanupTimer;
    private Timer? _pttDiagTimer;
    private CancellationTokenSource? _pipelineCts;
    private Task? _pipelineTask;
    private readonly PipelineWatchdog _watchdog = new();
    private int _reinitCount;
    private bool _needsReinit;
    private bool _hasEverBeenHealthy;
    private bool _deviceLost;
    private DateTime _starvationStart;

    // Recursos compartilhados (performance)
    private ID3D11Device? _sharedDevice;
    private IMFDXGIDeviceManager? _dxgiManager;
    private bool _mfStarted;

    // Cache getAudioSessions (~2s TTL)
    private string? _cachedAudioSessionsJson;
    private long _audioSessionsCacheTicks;

    // Message pump para WGC (STA thread que processa mensagens DWM)
    private WindowsMessagePump? _wgcPump;

    // Jogo customizado (seleção manual pelo usuário)
    private string _customGameProcess = "";

    // Jogo enviado no startCapture (nunca sobrescreve _customGameProcess)
    private string _pendingGameProcess = "";

    // Último jogo válido detectado (usado como fallback quando Electron rouba o foco)
    private GameInfo _lastDetectedGame = new();

    // Jogo alvo da captura atual — salvo em StartCapture, usado em reinit.
    // Persiste mesmo quando o usuário alt-tab, garantindo que a captura sempre
    // tente o mesmo jogo, não o foreground atual.
    private GameInfo _captureTargetGame = new();

    // HWND original da captura per-window. Mantido como fallback para quando
    // o jogo está minimizado e MainWindowHandle retorna Zero.
    private IntPtr _captureTargetHwnd = IntPtr.Zero;

    // True quando o jogo está em background (alt-tab) e a pipeline está
    // esperando o retorno em vez de fazer reinit.
    private bool _gameBackgrounded;

    // Debounce de foreground/background — evitam oscilação quando WGC
    // tem drops transitórios com o jogo ainda em foreground.
    private const int BG_DEBOUNCE_DROPS = 30; // ~500ms a 60fps
    private const int FG_DEBOUNCE_FRAMES = 15; // ~250ms a 60fps
    private int _bgDropCount;
    private int _fgGoodCount;

    // Jogo que o usuário parou manualmente com ToggleCapture (Alt+1)
    // Enquanto este jogo estiver em foreground, auto-start não dispara.
    // Limpo quando o foreground muda para outro processo.
    private string _userStoppedProcess = "";

    // Geração do mixer — incrementada cada vez que um novo mixer é criado.
    // Usada pelo fallback de áudio para ignorar checagens obsoletas após Stop/Start rápido.
    private int _audioMixerGeneration;

    // Evita restart concorrente da pipeline (ex: GameAudioOnly + OnGameChanged simultâneos)
    private bool _restartPending;
    private readonly object _restartLock = new();

    // True quando o áudio caiu para loopback completo (WasapiLoopbackSource)
    // porque o per-process loopback (ActivateAudioInterfaceAsync) foi bloqueado por anti-cheat
    private bool _audioFallback;

    // Dimensões reais da captura (usadas no encoder e export)
    private int _captureWidth;
    private int _captureHeight;

    // Eventos
    public event Action<EngineStatusValue>? OnStatusChanged;

    public EngineCoordinator(bool forceSoftware = false)
    {
        _config = new ConfigManager();

        if (forceSoftware)
            _config.Config.ForceSoftware = true;
        _clock = new MasterClock();
        _gameDetector = new GameDetector();
        _hotkeys = new HotkeyManager();
        _ptt = new PushToTalkManager(_hotkeys);
        _buffer = new ReplayBuffer(TimeSpan.FromSeconds(_config.Config.EffectiveReplaySeconds));
        _exporter = new ClipExporter();
        _pipeServer = new NamedPipeServer();
        _status = new EngineStatus();
        _audioSessions = new AudioSessionManager();

        // Configura PTT
        foreach (var vk in _config.Config.PushToTalkKeys)
            _ptt.AddPttKey((VirtualKey)vk);
        _ptt.Mode = NormalizePttMode(_config.Config.PttMode) switch
        {
            "Toggle" => PttMode.Toggle,
            "Hold" => PttMode.Hold,
            _ => PttMode.Off,
        };

        // Configura bindings dinâmicos
        ApplyHotkeyBindings();

        // Reage a mudanças no config (IPC setHotkeys etc.)
        _config.OnConfigChanged += _ =>
        {
            ApplyHotkeyBindings();
            // Reajusta buffer para maior duração necessária
            _buffer.MaxDuration = TimeSpan.FromSeconds(_config.Config.EffectiveReplaySeconds);
        };

        // Wire events
        _hotkeys.OnHotkeyPressed += OnHotkeyPressed;
        _gameDetector.OnGameChanged += OnGameChanged;
        _ptt.OnMicStateChanged += OnMicStateChanged;
        _pipeServer.OnMessage += OnIpcMessage;
        _pipeServer.GetStatus += GetStatusMessage;
        _pipeServer.OnStatusBroadcast += BroadcastStatus;
    }

    private void ApplyHotkeyBindings()
    {
        _hotkeys.UpdateBindings(_config.Config.HotkeyBindings);
    }

    public Task StartAsync()
    {
        Console.WriteLine("[EngineCoordinator] Iniciando...");

        // Load game database from games.json (falls back to hardcoded if not found)
        GameDetection.GameDatabase.Instance.Load();
        var gameCount = GameDetection.GameDatabase.Instance.GameCount;
        Console.WriteLine($"[EngineCoordinator] Game database: {(gameCount > 0 ? $"loaded {gameCount} games" : "using hardcoded fallback")}");

        // MFStartup singleton (performance: evita restart do MF a cada encoder/export)
        MediaFactory.MFStartup(false);
        _mfStarted = true;

        _wgcPump = new WindowsMessagePump();

        if (_config.Config.AutoCleanupEnabled)
            _cleanupTimer = new Timer(_ => RunAutoCleanup(), null, TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));
        else
            Console.WriteLine("[EngineCoordinator] AutoCleanup disabled");

        if (_config.Config.GameDetection)
        {
            _gameDetector.SetElectronPid(_config.Config.ElectronPid);
            _gameDetector.Start();
        }
        else
            Console.WriteLine("[EngineCoordinator] GameDetection OFF — detector não iniciado");
        _hotkeys.Start();
        _pipeServer.Start();

        _status.Update(s => { s.UptimeSeconds = 0; });

        Console.WriteLine("[EngineCoordinator] Pronto. Aguardando hotkeys...");
        Console.WriteLine("  F8=Salvar clip  F9=Iniciar/Parar captura  F10=Mutar microfone");
        Console.WriteLine("  Pipe: \\\\.\\pipe\\dinho-clips-engine");

        return Task.CompletedTask;
    }

    public Task StopAsync()
    {
        Console.WriteLine("[EngineCoordinator] Parando...");
        _cleanupTimer?.Dispose();
        _cleanupTimer = null;
        _pttDiagTimer?.Dispose();
        _pttDiagTimer = null;
        StopCapture();
        _pipeServer.Stop();
        _hotkeys.Stop();
        _gameDetector.Stop();
        _wgcPump?.Dispose();
        _wgcPump = null;
        if (_mfStarted)
        {
            MediaFactory.MFShutdown();
            _mfStarted = false;
        }

        return Task.CompletedTask;
    }

    private void OnHotkeyPressed(HotkeyPressedEventArgs e)
    {
        _status.Update(s => s.UptimeSeconds = (long)_clock.Now.TotalSeconds);

        switch (e.Action)
        {
            case HotkeyAction.SaveClip:
                _ = SaveClipAsync(e.ReplayDurationSeconds);
                break;
            case HotkeyAction.ToggleCapture:
                ToggleCapture();
                break;
            case HotkeyAction.ToggleMic:
                ToggleMic();
                break;
        }
    }

    private void ToggleCapture()
    {
        if (_captureActive)
            StopCapture();
        else
            StartCapture();
    }

    private void StartCapture()
    {
        lock (_pipelineLock)
        {
            if (_captureActive) return;

            // Se o usuário iniciou manualmente (Alt+1 ou botão), permite auto-start novamente
            _userStoppedProcess = "";

            _reinitCount = 0;
            _gameBackgrounded = false;
            _bgDropCount = 0;
            _fgGoodCount = 0;

            // Salva o alvo da captura ANTES de SelectCaptureSource.
            // Durante a gravação, ResolveTargetGame() sempre retorna este mesmo alvo,
            // mesmo que o usuário alt-tab para outra janela.
            _captureTargetGame = ResolveTargetGame();
            Console.WriteLine($"[EngineCoordinator] Buffer maxDuration={_config.Config.EffectiveReplaySeconds}s (ReplayTimeSeconds={_config.Config.ReplayTimeSeconds}s)");
            _captureActive = true;

            try
            {
                _sharedDevice?.Dispose();
                var creationFlags = DeviceCreationFlags.BgraSupport;

                // Use specific GPU adapter if configured
                IDXGIAdapter? selectedAdapter = null;
                if (_config.Config.AdapterIndex >= 0)
                {
                    try
                    {
                        using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
                        if (factory.EnumAdapters1(_config.Config.AdapterIndex, out var adapter).Success)
                            selectedAdapter = adapter;
                    }
                    catch { /* fall through to null */ }
                }

                var result = D3D11.D3D11CreateDevice(
                    selectedAdapter, DriverType.Hardware, creationFlags,
                    new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
                    out _sharedDevice, out _, out _);
                if (result.Failure || _sharedDevice is null)
                    throw new InvalidOperationException($"Falha ao criar D3D11 device: {result}");

                selectedAdapter?.Dispose();

                _capture?.Dispose();
                SelectCaptureSource();
                if (_capture == null)
                    throw new InvalidOperationException("Nenhum backend de captura disponível (WGC/DXGI/Hybrid falharam)");
                _captureWidth = Math.Max(_capture.Width, 320);
                _captureHeight = Math.Max(_capture!.Height, 240);

                _encoder?.Dispose();
                _encoder = EncoderManager.CreateBestEncoder(_config.Config.ForceSoftware, _sharedDevice, _config.Config.BitrateKbps);
                if (_encoder is FfmpegEncoder fe)
                    fe.SetQualityParams(
                        cq: _config.Config.Cq,
                        maxrateKbps: _config.Config.MaxrateKbps,
                        bufsizeKbps: _config.Config.BufsizeKbps,
                        bframes: _config.Config.Bframes,
                        lookahead: _config.Config.Lookahead,
                        preset: _config.Config.EncoderPreset,
                        codec: _config.Config.Codec);
                _encoder.Initialize(_captureWidth, _captureHeight, _config.Config.Fps, _config.Config.BitrateKbps);
                _status.Update(s => s.Encoder = _encoder.GetType().Name.Replace("Encoder", ""));

                _dxgiManager?.Dispose();
                _dxgiManager = MediaFactory.MFCreateDXGIDeviceManager();
                _dxgiManager.ResetDevice(_sharedDevice!).CheckError();
                _encoder.SetD3DManager(_dxgiManager);

                UpdateDxgiCropRect();

                _audioPacketCount = 0;
                var audioMixerGen = ++_audioMixerGeneration;
                _audioMixer = CreateAudioMixer();
                // Se PTT está em Hold/Toggle, o mic começa MUDO (PTT controla)
                // Se PTT está Off, usa o valor do config (sempre ligado/desligado)
                var pttMode = NormalizePttMode(_config.Config.PttMode);
                _audioMixer.MicEnabled = pttMode is "Hold" or "Toggle" ? false : _config.Config.MicEnabled;
                Console.WriteLine($"[EngineCoordinator] [initMic] MicEnabled={_audioMixer.MicEnabled} (pttMode={pttMode})");
                _audioMixer.GameGain = _config.Config.GameVolume;
                _audioMixer.MicGain = _config.Config.MicVolume;
                Console.WriteLine($"[EngineCoordinator] Gains iniciais: game={_config.Config.GameVolume:F2} mic={_config.Config.MicVolume:F2}");
                _audioMixer.OnMixedAudio += OnAudioPacket;
                _audioMixer.Start();

                _aacEncoder?.Dispose();
                _aacEncoder = new FfmpegAacEncoder();
                _aacEncoder.Initialize(_audioMixer.SampleRate, 2, 192000);

                _pipelineCts = new CancellationTokenSource();
                _pipelineTask = Task.Run(() => PipelineLoop(_pipelineCts.Token));

                _recording = true;
                _status.Update(s => s.Recording = true);

                _pttDiagTimer?.Dispose();
                _pttDiagTimer = new Timer(_ =>
                {
                    var pttMode = _config.Config.PttMode ?? "(null)";
                    var pttKeys = string.Join(",", _config.Config.PushToTalkKeys.Select(v => $"0x{v:X2}"));
                    var mixerInfo = _audioMixer != null ? $"micEnabled={_audioMixer.MicEnabled}" : "mixer=null";
                    Console.WriteLine($"[PTT-DIAG] mode={pttMode} _ptt.Mode={_ptt.Mode} _ptt.MicActive={_ptt.MicActive} pttKeys=[{pttKeys}] {mixerInfo}");
                }, null, TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(3));

                Console.WriteLine($"[EngineCoordinator] Gravação iniciada ({_capture!.Name}, {_captureWidth}x{_captureHeight})");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[EngineCoordinator] Falha ao iniciar captura: {ex.Message}");
                _captureActive = false;
                StopCapture();
            }
        }
    }

    private GameInfo ResolveTargetGame()
    {
        // Se já temos um alvo salvo (captura ativa), resolve seu HWND atual.
        // Isso garante que reinit ou crop sempre usem o MESMO jogo,
        // mesmo que o usuário tenha alt-tabado para outra janela.
        if (_captureTargetGame.IsValid && !string.IsNullOrEmpty(_captureTargetGame.ProcessName))
        {
            var resolved = ResolveProcessByName(_captureTargetGame.ProcessName);
            if (resolved.IsValid)
            {
                // Processo vivo com HWND válido — retorna
                Console.WriteLine($"[EngineCoordinator] Target game '{_captureTargetGame.ProcessName}' → HWND 0x{resolved.Hwnd:X8}");
                return resolved;
            }

            // Processo vivo mas sem MainWindowHandle (ex: minimizado)
            // Usa o HWND salvo original como fallback
            if (_captureTargetHwnd != IntPtr.Zero && IsProcessAlive(_captureTargetGame.ProcessName))
            {
                Console.WriteLine($"[EngineCoordinator] Target game '{_captureTargetGame.ProcessName}' vivo mas sem HWND — usando HWND salvo 0x{_captureTargetHwnd:X8}");
                return new GameInfo(
                    processName: _captureTargetGame.ProcessName,
                    executablePath: "",
                    windowTitle: "",
                    windowClass: "",
                    displayMode: DisplayMode.Unknown,
                    processId: 0,
                    hwnd: _captureTargetHwnd
                );
            }

            // Processo morreu — limpa e cai na lógica normal
            Console.WriteLine($"[EngineCoordinator] Target game '{_captureTargetGame.ProcessName}' morreu — resolvendo novo alvo");
            _captureTargetGame = new GameInfo();
            _captureTargetHwnd = IntPtr.Zero;
        }

        // Pending game process (do startCapture, usado uma vez e descartado)
        if (!string.IsNullOrEmpty(_pendingGameProcess))
        {
            var result = ResolveProcessByName(_pendingGameProcess);
            _pendingGameProcess = ""; // descarta após tentativa
            if (result.IsValid)
            {
                Console.WriteLine($"[EngineCoordinator] Pending game '{result.ProcessName}' → HWND 0x{result.Hwnd:X8}");
                return result;
            }
        }

        // Custom game process (seleção manual) tem prioridade
        if (!string.IsNullOrEmpty(_customGameProcess))
        {
            var result = ResolveProcessByName(_customGameProcess);
            if (result.IsValid)
            {
                Console.WriteLine($"[EngineCoordinator] Custom game '{_customGameProcess}' → HWND 0x{result.Hwnd:X8}");
                return result;
            }
        }

        // Jogo atual em foreground
        var current = _gameDetector.CurrentGame;
        if (current.IsValid)
            return current;

        // Fallback: último jogo válido detectado (ex: Electron roubou o foco)
        if (_lastDetectedGame.IsValid)
        {
            var fallback = ResolveProcessByName(_lastDetectedGame.ProcessName);
            if (fallback.IsValid)
            {
                Console.WriteLine($"[EngineCoordinator] Fallback para último jogo '{_lastDetectedGame.ProcessName}' → HWND 0x{fallback.Hwnd:X8}");
                return fallback;
            }
        }

        return current;
    }

    private static bool IsProcessAlive(string processName)
    {
        try
        {
            var name = processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                ? processName[..^4]
                : processName;
            return Process.GetProcessesByName(name).Length > 0;
        }
        catch { return false; }
    }

    private static GameInfo ResolveProcessByName(string processName)
    {
        var procName = processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? processName
            : processName + ".exe";

        try
        {
            var procs = System.Diagnostics.Process.GetProcessesByName(
                System.IO.Path.GetFileNameWithoutExtension(procName));
            if (procs.Length > 0)
            {
                var proc = procs[0];
                var hwnd = proc.MainWindowHandle;

                // Se MainWindowHandle é Zero (ex: jogo minimizado),
                // tenta EnumWindows para encontrar a janela pelo PID
                if (hwnd == IntPtr.Zero)
                    hwnd = FindWindowByProcessId(proc.Id);

                if (hwnd != IntPtr.Zero)
                {
                    return new GameDetection.GameInfo(
                        processName: proc.ProcessName,
                        executablePath: proc.MainModule?.FileName ?? "",
                        windowTitle: proc.MainWindowTitle,
                        windowClass: "",
                        displayMode: GameDetection.DisplayMode.Unknown,
                        processId: proc.Id,
                        hwnd: hwnd
                    );
                }

                // Processo vivo mas sem janela — ainda retorna info mínimo
                // para que o caller saiba que o processo existe
                return new GameDetection.GameInfo(
                    processName: proc.ProcessName,
                    executablePath: proc.MainModule?.FileName ?? "",
                    windowTitle: "",
                    windowClass: "",
                    displayMode: GameDetection.DisplayMode.Unknown,
                    processId: proc.Id,
                    hwnd: IntPtr.Zero
                );
            }
        }
        catch { }

        return new GameInfo();
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    private static IntPtr FindWindowByProcessId(int processId)
    {
        IntPtr foundVisible = IntPtr.Zero;
        IntPtr foundAny = IntPtr.Zero;
        EnumWindows((hwnd, _) =>
        {
            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == processId)
            {
                if (IsWindowVisible(hwnd))
                {
                    foundVisible = hwnd;
                    return false; // visible é preferencial, para aqui
                }
                if (foundAny == IntPtr.Zero)
                    foundAny = hwnd; // guarda primeira janela qualquer como fallback
            }
            return true;
        }, IntPtr.Zero);
        return foundVisible != IntPtr.Zero ? foundVisible : foundAny;
    }

    private static bool IsSystemWindowClass(string windowClass)
    {
        return windowClass switch
        {
            "Shell_TrayWnd" => true,           // Barra de tarefas
            "Progman" => true,                 // Área de trabalho (Desktop)
            "WorkerW" => true,                 // Desktop icons
            "DV2ControlHost" => true,          // Search charm / Cortana
            "Windows.UI.Core.CoreWindow" => true, // UWP genérico (exceto jogos conhecidos)
            "#32770" => true,                  // Dialog boxes
            "MSTaskListWClass" => true,        // Taskbar thumbnails
            "Shell_SecondaryTrayWnd" => true,  // Secondary monitor taskbar
            "NotifyIconOverflowWindow" => true,// System tray overflow
            _ => false,
        };
    }

    private static bool IsSystemExecutablePath(string executablePath)
    {
        if (string.IsNullOrEmpty(executablePath))
            return false;

        try
        {
            var windowsDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

            // Verifica se está em C:\Windows\ ou subdiretórios (System32, SysWOW64, etc.)
            if (executablePath.StartsWith(windowsDir, StringComparison.OrdinalIgnoreCase))
                return true;

            // Verifica se está em C:\Program Files\ (não-jogos conhecidos)
            // NOTA: Isso pode bloquear alguns jogos legítimos instalados em Program Files.
            // Por segurança, só bloqueamos subdiretórios comuns não-jogo.
            if (programFiles != null &&
                executablePath.StartsWith(programFiles, StringComparison.OrdinalIgnoreCase))
            {
                // Exceções: jogos conhecidos em Program Files
                var lowerPath = executablePath.ToLowerInvariant();
                if (lowerPath.Contains("\\steam\\steamapps\\common\\") ||
                    lowerPath.Contains("\\epic games\\") ||
                    lowerPath.Contains("\\ubisoft\\") ||
                    lowerPath.Contains("\\battlenet\\") ||
                    lowerPath.Contains("\\rockstar games\\") ||
                    lowerPath.Contains("\\electronic arts\\"))
                    return false;

                return true;
            }

            if (programFilesX86 != null &&
                executablePath.StartsWith(programFilesX86, StringComparison.OrdinalIgnoreCase))
            {
                var lowerPath = executablePath.ToLowerInvariant();
                if (lowerPath.Contains("\\steam\\steamapps\\common\\") ||
                    lowerPath.Contains("\\epic games\\") ||
                    lowerPath.Contains("\\ubisoft\\") ||
                    lowerPath.Contains("\\battlenet\\") ||
                    lowerPath.Contains("\\rockstar games\\") ||
                    lowerPath.Contains("\\electronic arts\\"))
                    return false;

                return true;
            }

            // Bloqueia executáveis em %LocalAppData%\Programs\ (instaladores NSIS/não-MSIX)
            // — é onde electron-builder/NSIS instala apps como o DiNho Optimizer
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (localAppData != null &&
                executablePath.StartsWith(Path.Combine(localAppData, "Programs"), StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        catch { }

        return false;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowLongW(IntPtr hWnd, int nIndex);

    private const int GWL_EXSTYLE = -20;
    private const uint WS_EX_NOREDIRECTIONBITMAP = 0x00200000;

    [DllImport("user32.dll")]
    private static extern IntPtr GetDesktopWindow();

    private static bool IsWindowValidForWgc(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        // Desktop window pseudo-HWND (0x00010010) não funciona com WGC per-window
        if (hwnd == GetDesktopWindow())
        {
            Console.WriteLine("[EngineCoordinator] Desktop window — WGC per-window não funcionará, pulando para desktop capture");
            return false;
        }
        if (!IsWindowVisible(hwnd)) return false;
        if (IsIconic(hwnd)) return false;
        var exStyle = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if ((exStyle & WS_EX_NOREDIRECTIONBITMAP) != 0)
        {
            Console.WriteLine($"[EngineCoordinator] Janela 0x{hwnd:X8} tem WS_EX_NOREDIRECTIONBITMAP — WGC per-window não funcionará");
            return false;
        }
        return true;
    }

 	private void SelectCaptureSource()
 	{
 		var game = _captureTargetGame;
 		var gameHwnd = game.IsValid ? game.Hwnd : IntPtr.Zero;

 		// Salva o HWND original para usar como fallback em reinit
 		// (quando o jogo está minimizado, MainWindowHandle pode ser Zero)
 		if (gameHwnd != IntPtr.Zero)
 			_captureTargetHwnd = gameHwnd;

 		// 1) WGC per-window (melhor qualidade) — tenta até 3x com 400ms entre tentativas
 		if (game.IsValid && gameHwnd != IntPtr.Zero && IsWindowValidForWgc(gameHwnd))
 		{
 			const int maxRetries = 3;
 			const int retryDelayMs = 400;

 			for (var attempt = 1; attempt <= maxRetries; attempt++)
 			{
 				try
 				{
 					var wgc = new WgcCaptureSource();
 					_wgcPump!.Invoke(() =>
 					{
 						wgc.Initialize(_sharedDevice, gameHwnd);
 						wgc.StartFramePump();
 					});
 					_capture = wgc;
 					_status.Update(s => s.CaptureBackend = $"WGC:{game.ProcessName}");
 					Console.WriteLine($"[EngineCoordinator] Captura: janela '{game.ProcessName}' ({gameHwnd})");
 					goto multiMonitor;
 				}
 				catch (Exception ex) when (attempt < maxRetries)
 				{
 					var innerMsg = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
 					Console.Error.WriteLine($"[EngineCoordinator] WGC window tentativa {attempt}/{maxRetries} falhou: {ex.Message}{innerMsg}, retry em {retryDelayMs}ms...");
 					Thread.Sleep(retryDelayMs);
 				}
 				catch (Exception ex)
 				{
 					var innerMsg = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
 					Console.Error.WriteLine($"[EngineCoordinator] WGC window tentativa {maxRetries}/{maxRetries} falhou: {ex.Message}{innerMsg}, fallback...");
 				}
 			}
 		}

        // 2) WGC desktop (full monitor via DWM) — funciona para qualquer janela
        try
        {
            var wgc = new WgcCaptureSource();
            _wgcPump!.Invoke(() =>
            {
                wgc.Initialize(_sharedDevice);
                wgc.StartFramePump();
            });
            _capture = wgc;
            _status.Update(s => s.CaptureBackend = "WGC");
            Console.WriteLine("[EngineCoordinator] Captura: Windows Graphics Capture (desktop)");
            goto multiMonitor;
        }
        catch (Exception wgcEx)
        {
            var innerMsg = wgcEx.InnerException != null ? $" → {wgcEx.InnerException.GetType().Name}: {wgcEx.InnerException.Message}" : "";
            Console.Error.WriteLine($"[EngineCoordinator] WGC desktop falhou: {wgcEx.GetType().Name}: {wgcEx.Message}{innerMsg}");
        }

        // 3) DXGI Desktop Duplication (full monitor, funciona sempre)
        try
        {
            var dxgi = new DxgiCaptureSource();
            dxgi.Initialize(_sharedDevice, gameHwnd);
            _capture = dxgi;
            _status.Update(s => s.CaptureBackend = "DXGI");
            Console.WriteLine("[EngineCoordinator] Captura: DXGI Desktop Duplication");
            goto multiMonitor;
        }
        catch (Exception dxgiEx)
        {
            Console.Error.WriteLine($"[EngineCoordinator] DXGI falhou: {dxgiEx.GetType().Name}: {dxgiEx.Message}");
        }

        // 4) Hybrid (DXGI + PrintWindow) — fallback para janela em background
        try
        {
            var hybrid = new HybridCaptureSource();
            hybrid.Initialize(_sharedDevice, gameHwnd);
            _capture = hybrid;
            _status.Update(s => s.CaptureBackend = _capture.Name);
            Console.WriteLine($"[EngineCoordinator] Captura híbrida: HWND=0x{gameHwnd:X8}");
            goto multiMonitor;
        }
        catch (Exception hybridEx)
        {
            Console.Error.WriteLine($"[EngineCoordinator] Hybrid falhou: {hybridEx.GetType().Name}: {hybridEx.Message}");
        }

        multiMonitor:
        // Detecta configuração multi-monitor
        var monitorCount = MonitorHelper.GetMonitorCount();
        if (monitorCount > 1 && game.IsValid)
        {
            var gameMonitor = MonitorHelper.GetMonitorFromWindow(game.Hwnd);
            Console.WriteLine($"[EngineCoordinator] Multi-monitor: {monitorCount} telas, jogo no monitor {gameMonitor}");
        }
    }

    private AudioMixer CreateAudioMixer()
    {
        _audioFallback = false;
        var cfg = _config.Config;
        var sampleRate = cfg.AudioSampleRate is 44100 or 48000 or 96000 ? cfg.AudioSampleRate : 48000;

        // GameAudioOnly=true  → CppLoopbackSource (só jogo + mic via C++ DLL)
        // GameAudioOnly=false → WasapiLoopbackSource (áudio completo do sistema)
        // GameAudioOnly vem do Electron, controlado pelos toggles na UI

        if (cfg.UseExcludeMode && cfg.ExcludeProcessId > 0)
        {
            Console.WriteLine($"[EngineCoordinator] Áudio: EXCLUDE mode (C++ DLL) — excluindo PID {cfg.ExcludeProcessId} (e filhos), capturando TODO o resto");
            _loopbackSource = new CppLoopbackSource(cfg.ExcludeProcessId, includeTree: false, sampleRate: sampleRate);
        }
        else
        {
            var selectedPids = cfg.SelectedAudioSessions;

            if (selectedPids.Count > 0)
            {
                var processes = ResolveAudioPids(selectedPids);

                if (processes.Count > 0)
                {
                    Console.WriteLine($"[EngineCoordinator] Áudio: CppLoopbackSource INCLUDE para {processes.Count} processo(s)");
                    foreach (var (pid, name) in processes)
                        Console.WriteLine($"[EngineCoordinator]   PID alvo {pid}: {name}");

                    // VAD INCLUDE mode captura o processo + filhos (includeTree=true)
                    // Para múltiplos PIDs, capturamos apenas o primeiro (includeTree já pega filhos)
                    var (targetPid, procName) = processes[0];
                    _loopbackSource = new CppLoopbackSource(targetPid, includeTree: true, sampleRate: sampleRate);

                    _audioFallback = false;
                }
                else
                {
                    Console.WriteLine("[EngineCoordinator] Nenhum PID selecionado está vivo — usando loopback completo");
                    _loopbackSource = new WasapiLoopbackSource(sampleRate);
                }
            }
            else
            {
                _loopbackSource = new WasapiLoopbackSource(sampleRate);
                Console.WriteLine("[EngineCoordinator] Áudio: captura completa (loopback) — NENHUM filtro ativo");
            }
        }

        _micSource = string.IsNullOrEmpty(_config.Config.MicDeviceId)
            ? new WasapiMicSource(sampleRate)
            : new WasapiMicSource(sampleRate, _config.Config.MicDeviceId);
        return new AudioMixer(_loopbackSource, _micSource, _clock);
    }

    private void StopCapture()
    {
        lock (_pipelineLock)
        {
            _recording = false;
            _captureActive = false;
            _captureTargetGame = new GameInfo();
            _captureTargetHwnd = IntPtr.Zero;
            _gameBackgrounded = false;
            _bgDropCount = 0;
            _fgGoodCount = 0;

            _pipelineCts?.Cancel();
            try
            {
                _pipelineTask?.Wait(2000);
            }
            catch (AggregateException)
            {
                // Pipeline cancelado ou falhou, ignorar
            }
            _pipelineTask = null;
            _pipelineCts = null;

            _audioMixer?.Stop();
            _audioMixer?.Dispose();
            _audioMixer = null;

            if (_loopbackSource != null)
            {
                _loopbackSource.Stop();
                _loopbackSource.Dispose();
                _loopbackSource = null;
            }

            if (_micSource != null)
            {
                _micSource.Stop();
                _micSource.Dispose();
                _micSource = null;
            }

            if (_aacEncoder != null)
            {
                var remaining = new List<EncodedPacket>();
                _aacEncoder.FlushAndDrain(remaining);
                foreach (var pkt in remaining)
                {
                    var correctedPts = ConsumePcmPts();
                    var corrected = new EncodedPacket(pkt.Data, pkt.Type, correctedPts, pkt.Duration, pkt.IsKeyFrame);
                    _buffer.AddAudio(corrected);
                }
                _aacEncoder.Dispose();
                _aacEncoder = null;
            }

            _capture?.Dispose();
            _capture = null;

            _pttDiagTimer?.Dispose();
            _pttDiagTimer = null;

            _encoder?.Dispose();
            _encoder = null;

            _sharedDevice?.Dispose();
            _sharedDevice = null;

            _dxgiManager?.Dispose();
            _dxgiManager = null;

            _status.Update(s => s.Recording = false);
            Console.WriteLine("[EngineCoordinator] Captura parada.");
        }
    }

    private async Task PipelineLoop(CancellationToken ct)
    {
        var frameIntervalUs = 1_000_000L / _config.Config.Fps;
        var frameDuration = TimeSpan.FromSeconds(1.0 / _config.Config.Fps);
        var frameDurationHns = frameDuration.Ticks;
        var freq = Stopwatch.Frequency;
        var freqPerUs = freq / 1_000_000L;
        var spinTargetTicks = 0L;
            var modeCheckDue = DateTime.UtcNow;
            var diagFrames = 0;

        while (!ct.IsCancellationRequested && _capture != null && _encoder != null)
        {
            var cap = _capture;
            var enc = _encoder;

            var beforeCapture = Stopwatch.GetTimestamp();
            try
            {
                int captureTimeout = Math.Max(1, Math.Min(100, 1000 / _config.Config.Fps));
                using var frame = cap.TryCaptureFrame(captureTimeout);
                if (++diagFrames % 60 == 1)
                {
                    var captureType = _capture?.GetType().Name ?? "null";
                    Console.WriteLine($"[PipelineDiag] frame.Success={frame.Success} texture={(frame.Texture != null ? "ok" : "null")} " +
                        $"capture={captureType} encoder={(_encoder?.GetType().Name ?? "null")}");
                }
                if (frame.Success)
                {
                    if (frame.Texture != null)
                    {
                        if (_gameBackgrounded && frame.Texture != null)
                        {
                            _fgGoodCount++;
                            if (_fgGoodCount >= FG_DEBOUNCE_FRAMES)
                            {
                                _gameBackgrounded = false;
                                _fgGoodCount = 0;
                                Console.WriteLine("[Pipeline] Jogo retornou ao foreground — frames retomados");
                            }
                        }
                        else
                        {
                            _fgGoodCount = 0;
                        }
                        _bgDropCount = 0;
                        _starvationStart = default;
                        var encoded = enc.EncodeFrame(frame.Texture, _clock.Now);
                        if (encoded != null)
                        {
                            _buffer.AddVideo(encoded);
                            var elapsedMs = (Stopwatch.GetTimestamp() - beforeCapture) * 1000.0 / Stopwatch.Frequency;
                            _watchdog.ReportGoodFrame(elapsedMs);
                            _hasEverBeenHealthy = true;
                        }
                        else
                        {
                            _watchdog.ReportDroppedFrame(PipelineIssue.EncodeError);
                        }
                    }
                    else
                    {
                        if (_starvationStart == default)
                            _starvationStart = DateTime.UtcNow;
                    }
                }
                else
                {
                    if (_starvationStart == default)
                        _starvationStart = DateTime.UtcNow;
                    _watchdog.ReportDroppedFrame(PipelineIssue.NoFrame);
                }

                if (!_needsReinit)
                {
                    // Se o processo alvo ainda está vivo e usamos WGC per-window,
                    // NÃO reinicia JAMAIS — o usuário só alt-tabou e vai voltar.
                    // WGC per-window retoma frames naturalmente quando o jogo
                    // voltar ao foreground. O watchdog é resetado para evitar
                    // que o acúmulo de frames dropped dispare ShouldReinit()
                    // quando o jogo retornar.
                    if (_capture is WgcCaptureSource && _captureTargetGame.IsValid &&
                        IsProcessAlive(_captureTargetGame.ProcessName))
                    {
                        _bgDropCount++;
                        if (_bgDropCount >= BG_DEBOUNCE_DROPS)
                        {
                            if (!_gameBackgrounded)
                            {
                                _gameBackgrounded = true;
                                Console.WriteLine("[Pipeline] Jogo em background (alt-tab) — frames ausentes. Aguardando retorno...");
                            }
                            _starvationStart = default;
                            _watchdog.Reset();
                        }
                    }
                    else if (_watchdog.ShouldReinit()
                        || (_starvationStart != default && (DateTime.UtcNow - _starvationStart).TotalSeconds > 8))
                    {
                        // Se o processo alvo MORREU enquanto backgrounded, sai do loop
                        // (não chama StopCapture() aqui para evitar deadlock com _pipelineTask.Wait)
                        if (_gameBackgrounded && _captureTargetGame.IsValid &&
                                 !IsProcessAlive(_captureTargetGame.ProcessName))
                        {
                            Console.WriteLine($"[Pipeline] Jogo '{_captureTargetGame.ProcessName}' fechou enquanto backgrounded — encerrando pipeline");
                            _recording = false;
                            _captureActive = false;
                            _captureTargetGame = new GameInfo();
                            _captureTargetHwnd = IntPtr.Zero;
                            break;
                        }
                        else
                        {
                            var health = _watchdog.GetHealth();
                            Console.Error.WriteLine($"[Pipeline] Reinit acionado: watchdog={_watchdog.ShouldReinit()} starvation={_starvationStart != default} " +
                                $"consecutiveGood={health.ConsecutiveGoodFrames} dropped={health.DroppedFrames}/{health.TotalFrames} " +
                                $"lastIssue={health.LastIssue} reinitCount={_reinitCount}");
                            _needsReinit = true;
                            _reinitCount++;
                            _ = ReinitializePipelineAsync();
                        }
                    }
                }

                if (modeCheckDue <= DateTime.UtcNow)
                {
                    modeCheckDue = DateTime.UtcNow.AddSeconds(2);
                    // Mode switching (DXGI↔PrintWindow) é gerenciado internamente
                    // pelo HybridCaptureSource via PickDesiredMode().
                    // Crop é atualizado uma vez no startup — não periodicamente,
                    // pois Flush() reinicia o ffmpeg e causa flickering.
                }

                _status.Update(s =>
                {
                    s.LastFrameMs = _watchdog.GetHealth().AvgFrameTimeMs;
                    s.WatchdogOk = _watchdog.GetHealth().Level != HealthLevel.Red;
                    var (vFramesTotal, _, _, bytesTotal) = _buffer.Stats();
                    s.ReplayBufferBytes = bytesTotal;
                    var d = _buffer.StatsDetailed();
                    s.ReplayBufferVideoFrames = d.videoCount;
                    s.ReplayBufferVideoBytes = d.videoBytes;
                    s.ReplayBufferAudioPackets = d.audioCount;
                    s.ReplayBufferAudioBytes = d.audioBytes;
                });

                // Log de RAM a cada ~60 frames (~1s a 60fps)
                if (diagFrames % 60 == 0)
                {
                    var d = _buffer.StatsDetailed();
                    double videoMb = d.videoBytes / (1024.0 * 1024.0);
                    double audioMb = d.audioBytes / (1024.0 * 1024.0);
                    double totalMb = videoMb + audioMb;
                    Console.WriteLine($"[RAM] video={d.videoCount}frames {videoMb:F1}MB | audio={d.audioCount}pkts {audioMb:F1}MB | total={totalMb:F1}MB | duracao={d.videoDuration.TotalSeconds:F1}s");
                }
            }
            catch (Exception ex)
            {
                if (cap.CheckDeviceLost())
                {
                    _deviceLost = true;
                    _needsReinit = true;
                    Console.Error.WriteLine($"[Pipeline] Device D3D11 perdido! Recriando...");
                }
                _watchdog.ReportDroppedFrame(PipelineIssue.CaptureError);
                Console.Error.WriteLine($"[Pipeline] Erro: {ex}");
            }

            // Timing preciso (QPC-based): sleep para o bulk, spin para o residual
            var elapsedSinceCapture = Stopwatch.GetTimestamp() - beforeCapture;
            var elapsedUs = elapsedSinceCapture / freqPerUs;
            var remainingUs = frameIntervalUs - elapsedUs;
            if (remainingUs > 500)
            {
                var remainingMs = (int)(remainingUs / 1000);
                await Task.Delay(Math.Max(1, remainingMs - 1), ct);
                spinTargetTicks = beforeCapture + frameIntervalUs * freqPerUs;
            }
            else
            {
                spinTargetTicks = beforeCapture + frameIntervalUs * freqPerUs;
            }

            while (Stopwatch.GetTimestamp() < spinTargetTicks && !ct.IsCancellationRequested)
                Thread.SpinWait(8);
        }

        var reason = ct.IsCancellationRequested ? "cancelamento" :
                     _capture == null ? "captura nula" :
                     _encoder == null ? "encoder nulo" : "desconhecido";
        Console.Error.WriteLine($"[Pipeline] Loop encerrado: {reason}");
    }

    private void SwitchCaptureApi()
    {
        // Gerenciado internamente pelo HybridCaptureSource.
        // Se o _capture não for híbrido, faz reinit.
        _watchdog.ReportApiSwitch();
        _needsReinit = true;
        _ = ReinitializePipelineAsync();
    }

    private async Task ReinitializePipelineAsync()
    {
        var reinitGame = _gameDetector.CurrentGame;
        Console.WriteLine($"[EngineCoordinator] Reinicializando pipeline (watchdog)... foreground='{reinitGame.ProcessName}' hwnd=0x{reinitGame.Hwnd:X8} starvationSec={(_starvationStart != default ? (DateTime.UtcNow - _starvationStart).TotalSeconds.ToString("F1") : "N/A")}");

        if (!_captureActive)
        {
            _needsReinit = false;
            return;
        }

        // Cancela o pipeline loop antigo e aguarda sua parada
        _pipelineCts?.Cancel();
        if (_pipelineTask != null)
        {
            try { await _pipelineTask.WaitAsync(TimeSpan.FromSeconds(2)); }
            catch { }
        }
        _pipelineCts = null;
        _pipelineTask = null;

        try
        {
            if (_deviceLost)
            {
                _sharedDevice?.Dispose();
                _sharedDevice = null;
                _dxgiManager?.Dispose();
                _dxgiManager = null;

                var creationFlags = DeviceCreationFlags.BgraSupport;
                var result = D3D11.D3D11CreateDevice(
                    null, DriverType.Hardware, creationFlags,
                    new[] { FeatureLevel.Level_11_1, FeatureLevel.Level_11_0 },
                    out _sharedDevice, out _, out _);
                if (result.Success && _sharedDevice is not null)
                {
                    _dxgiManager = MediaFactory.MFCreateDXGIDeviceManager();
                    _dxgiManager.ResetDevice(_sharedDevice!).CheckError();
                    Console.Error.WriteLine("[EngineCoordinator] Device D3D11 recriado após TDR/device lost.");
                }

                _deviceLost = false;
            }

            _capture?.Dispose();
            _capture = null;

            SelectCaptureSource();

            // Reinicia o encoder (ffmpeg pode ter travado ou atrasado)
            _encoder?.Dispose();
            _encoder = EncoderManager.CreateBestEncoder(_config.Config.ForceSoftware, _sharedDevice, _config.Config.BitrateKbps);
            if (_encoder is FfmpegEncoder fe)
                fe.SetQualityParams(
                    cq: _config.Config.Cq,
                    maxrateKbps: _config.Config.MaxrateKbps,
                    bufsizeKbps: _config.Config.BufsizeKbps,
                    bframes: _config.Config.Bframes,
                    lookahead: _config.Config.Lookahead,
                    preset: _config.Config.EncoderPreset,
                    codec: _config.Config.Codec);
            _encoder.Initialize(_captureWidth, _captureHeight, _config.Config.Fps, _config.Config.BitrateKbps);
            _status.Update(s => s.Encoder = _encoder.GetType().Name.Replace("Encoder", ""));

            if (_capture != null)
            {
                _starvationStart = default;
                _watchdog.Reset();
                _pipelineCts = new CancellationTokenSource();
                _pipelineTask = Task.Run(() => PipelineLoop(_pipelineCts.Token));
                _needsReinit = false;
                if (_hasEverBeenHealthy)
                    _status.Update(snap => snap.LastCrashRecovered = true);
                Console.WriteLine($"[EngineCoordinator] Pipeline reinicializado com sucesso ({_capture!.Name}, {_captureWidth}x{_captureHeight}).");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[EngineCoordinator] Falha na reinicialização: {ex.Message}");
            _recording = false;
            _captureActive = false;
        }
    }

    private int _audioPacketCount;
    private const int MaxPcmPtsQueue = 10000;
    private readonly Queue<(TimeSpan pts, int samples)> _pcmPtsQueue = new();
    private int _aacFramesProduced;
    private int _audioSampleRate = 48000;
    private int _audioChannels = 2;

    /// <summary>
    /// Retorna o PTS estimado para o próximo frame AAC com base nos
    /// PTS reais dos pacotes PCM de entrada (AudioMixer usa _clock.Now).
    /// </summary>
    private TimeSpan ConsumePcmPts(int aacSamples = 1024)
    {
        int samplesPerFrame = aacSamples * _audioChannels;
        int needed = samplesPerFrame;
        TimeSpan result = TimeSpan.Zero;
        bool first = true;

        while (needed > 0 && _pcmPtsQueue.Count > 0)
        {
            var (pts, samples) = _pcmPtsQueue.Peek();
            if (first) { result = pts; first = false; }
            int take = Math.Min(needed, samples);
            needed -= take;
            if (take >= samples)
                _pcmPtsQueue.Dequeue();
            else
            {
                // Partial consume — avança PTS pelos samples consumidos
                _pcmPtsQueue.Dequeue();
                _pcmPtsQueue.Enqueue((pts + TimeSpan.FromSeconds((double)take / _audioSampleRate), samples - take));
            }
        }

        if (first) // Fila vazia — fallback para PTS estimado
            result = TimeSpan.FromTicks(_aacFramesProduced * 1024L * 10_000_000 / _audioSampleRate);

        return result;
    }

    private void OnAudioPacket(EncodedPacket packet)
    {
        if (!_recording) return;

        _audioPacketCount++;
        int sampleCount = packet.PcmSamples?.Length ?? packet.Data.Length / 4;
        if (_audioPacketCount <= 5 || _audioPacketCount % 100 == 0)
            Console.WriteLine($"[AudioDiag] packet #{_audioPacketCount} samples={sampleCount} ts={packet.Pts.TotalSeconds:F2}");

        // Enfileira o PTS real do mixer (baseado em _clock.Now) + contagem de samples
        if (_pcmPtsQueue.Count >= MaxPcmPtsQueue)
            _pcmPtsQueue.Dequeue();
        _pcmPtsQueue.Enqueue((packet.Pts, sampleCount));

        if (packet.PcmSamples != null)
            _aacEncoder?.EncodeAudio(packet.PcmSamples);
        int aacCount = 0;
        while (_aacEncoder?.TryReadPacket() is { } aacPkt)
        {
            aacCount++;
            // Corrige o PTS do AAC: usa o PTS real do PCM de entrada em vez do
            // _outputFrameIndex * dur (que ignora delays de encoding)
            var correctedPts = ConsumePcmPts();
            var corrected = new EncodedPacket(aacPkt.Data, aacPkt.Type, correctedPts, aacPkt.Duration, aacPkt.IsKeyFrame);
            _buffer.AddAudio(corrected);
            _aacFramesProduced++;
        }
        if ((_audioPacketCount <= 5 || _audioPacketCount % 100 == 0) && aacCount > 0)
            Console.WriteLine($"[AudioDiag] packet #{_audioPacketCount}: AAC frames produced={aacCount}");
    }

    private List<(int Pid, string Name)> ResolveAudioPids(Dictionary<int, string> selectedPids)
    {
        var resolved = new Dictionary<int, string>();
        foreach (var (pid, name) in selectedPids)
        {
            bool alive = false;
            try { using var p = Process.GetProcessById(pid); alive = !p.HasExited; } catch { }

            if (alive)
            {
                resolved[pid] = name;
                // Inclui subprocessos — FiveM e outros jogos modernos usam múltiplos processos
                // e o áudio pode vir de um filho (ex: FiveM_GTAProcess.exe)
                var children = GetChildProcesses(pid);
                foreach (var childPid in children)
                {
                    if (!resolved.ContainsKey(childPid))
                    {
                        resolved[childPid] = $"{name}>child#{childPid}";
                        Console.WriteLine($"[EngineCoordinator] Subprocesso encontrado: PID {childPid} (filho de {name}/{pid})");
                    }
                }
            }
            else
            {
                var matches = Process.GetProcessesByName(name.Replace(".exe", ""));
                var found = matches.FirstOrDefault(p => !p.HasExited);
                if (found != null)
                {
                    Console.WriteLine($"[EngineCoordinator] PID {pid} ({name}) morto na resolução — resolvido para PID {found.Id}");
                    resolved[found.Id] = name;
                    // Também inclui subprocessos do PID resolvido
                    var children = GetChildProcesses(found.Id);
                    foreach (var childPid in children)
                    {
                        if (!resolved.ContainsKey(childPid))
                        {
                            resolved[childPid] = $"{name}>child#{childPid}";
                            Console.WriteLine($"[EngineCoordinator] Subprocesso {childPid} de {name} (resolvido)");
                        }
                    }
                }
            }
        }
        return resolved.Select(kvp => (kvp.Key, kvp.Value)).ToList();
    }

    // Find all direct child processes of a given PID using CreateToolhelp32Snapshot
    private static HashSet<int> GetChildProcesses(int parentPid)
    {
        var children = new HashSet<int>();
        IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == INVALID_HANDLE_VALUE)
            return children;

        try
        {
            var entry = new PROCESSENTRY32();
            entry.dwSize = Marshal.SizeOf<PROCESSENTRY32>();

            if (Process32First(snapshot, ref entry))
            {
                do
                {
                    if (entry.th32ParentProcessID == parentPid && entry.th32ProcessID != parentPid)
                        children.Add(entry.th32ProcessID);
                } while (Process32Next(snapshot, ref entry));
            }
        }
        finally
        {
            CloseHandle(snapshot);
        }

        return children;
    }

    private async Task SaveClipAsync(int? customDurationSeconds = null)
    {
        // Anti-double-press (spec 14.1)
        lock (_exportLock)
        {
            if (_exportInProgress)
            {
                Console.WriteLine("[EngineCoordinator] Export já em andamento, ignorando duplicado");
                return;
            }
            _exportInProgress = true;
        }

        try
        {
            var durationLabel = customDurationSeconds.HasValue
                ? $"{customDurationSeconds}s (binding)"
                : $"{_config.Config.ReplayTimeSeconds}s (padrão)";
            Console.WriteLine($"[EngineCoordinator] Exportando clip ({durationLabel})...");

            // Verifica espaço em disco (spec 14.1)
            var outputDir = GetOutputDirectory();
            var driveInfo = new DriveInfo(outputDir);
            if (driveInfo.AvailableFreeSpace < 100_000_000) // 100MB mínimo
            {
                Console.Error.WriteLine("[EngineCoordinator] Espaço em disco insuficiente para export");
                return;
            }

            // Freeze buffer (spec 5.1) — se bind tem duração custom, trunca
            var truncateTo = customDurationSeconds.HasValue
                ? TimeSpan.FromSeconds(customDurationSeconds.Value)
                : TimeSpan.FromSeconds(_config.Config.ReplayTimeSeconds);
            var (video, audio) = _buffer.GetSegments(truncateTo);
            Console.WriteLine($"[AudioDiag] SaveClip: video={video.Count} frames, audio={audio.Count} packets");
            if (video.Count == 0)
            {
                Console.WriteLine("[EngineCoordinator] Nada para exportar (buffer vazio)");
                return;
            }

            var fileName = $"DiNho Optimizer {DateTime.Now:yyyy-MM-dd_HH-mm-ss}.mp4";
            var outputPath = Path.Combine(outputDir, fileName);

            await Task.Run(() =>
            {
                var result = _exporter.ExportToMp4(
                    outputPath,
                    video,
                    audio,
                    _captureWidth,
                    _captureHeight,
                    _config.Config.Fps);

                var fileInfo = new FileInfo(result);
                Console.WriteLine($"[EngineCoordinator] Clip salvo: {result} ({fileInfo.Length / 1024} KB)");
                _status.Update(s => s.LastClipSize = fileInfo.Length);
            });
        }
        finally
        {
            lock (_exportLock)
            {
                _exportInProgress = false;
            }
        }
    }

    private async Task<IpcMessage?> SaveClipAndRespondAsync()
    {
        try
        {
            await SaveClipAsync();
            return new IpcMessage { Action = "ok" };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[EngineCoordinator] Export falhou: {ex.Message}");
            return new IpcMessage
            {
                Action = "error",
                Value = JsonSerializer.SerializeToElement(new { error = $"Export failed: {ex.Message}" })
            };
        }
    }

    private string GetOutputDirectory()
    {
        if (!string.IsNullOrEmpty(_config.Config.OutputDirectory))
            return _config.Config.OutputDirectory;

        // Default: Desktop\DiNhoClips
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
        var dir = Path.Combine(desktop, "DiNhoClips");
        Directory.CreateDirectory(dir);
        return dir;
    }

    private void ToggleMic()
    {
        if (_audioMixer != null)
        {
            _audioMixer.MicEnabled = !_audioMixer.MicEnabled;
            Console.WriteLine($"[EngineCoordinator] [toggleMic] Microfone: {(_audioMixer.MicEnabled ? "ATIVO" : "MUTO")}");
        }
    }

    private static readonly HashSet<string> NonGameProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "electron",
        "DiNho Optimizer",
        "dinho-optimizer",
        System.Diagnostics.Process.GetCurrentProcess().ProcessName,
        // === Sistema ===
        "explorer", "SearchHost", "ShellExperienceHost", "StartMenuExperienceHost",
        "Taskmgr", "TaskManager", "RuntimeBroker", "ApplicationFrameHost",
        "sihost", "svchost", "ctfmon", "smartscreen",
        "SystemSettings", "Calculator", "Photos", "LockApp",
        "PeopleExperienceHost", "ScreenClippingHost", "TextInputHost",
        "WindowsTerminal", "conhost", "cmd", "powershell", "pwsh",
        "regedit", "gpedit", "msconfig", "resmon", "perfmon",
        "diskmgmt", "compmgmt", "taskschd", "eventvwr",
        "dxdiag", "winver", "mstsc", "msra",
        "powershell_ise", "wsl", "bash",
        "msra", "migwiz", "control", "mmc",
        // === Navegadores ===
        "chrome", "firefox", "msedge", "brave", "opera", "vivaldi",
        "yandex", "tor", "waterfox", "palemoon",
        "maxthon", "arc", "sidekick", "opera_gx",
        "iridium", "centbrowser", "slimjet", "comodo_dragon",
        "epic", "naver",
        // === Dev Tools ===
        "Code", "devenv", "clion64", "rider64", "idea64", "pycharm64",
        "webstorm64", "phpstorm64", "rubymine64", "goland64",
        "sublime_text", "subl", "atom", "notepad++", "notepadpp",
        "vim", "gvim", "nvim", "emacs",
        "eclipse", "android-studio", "studio64", "studio",
        "netbeans", "jetbrains-toolbox",
        "git-bash", "git-cmd", "gitgui", "gitk",
        "cmder", "mintty", "windbg",
        "obsidian", "logseq", "typora",
        "postman", "insomnia", "docker", "kubectl",
        "sql-server", "ssms", "mysql-workbench", "sqldeveloper",
        "filezilla", "winscp", "putty", "kitty",
        "nm-applet", "wireshark", "fiddler",
        // === Mídia / Design ===
        "vlc", "mpc-hc", "mpc-be", "spotify", "wmplayer", "mplayerc",
        "PotPlayerMini64", "PotPlayerMini",
        "stremio", "kodi", "plex", "plexmediaplayer",
        "mpv", "mpv.net", "foobar2000", "winamp",
        "audacity", "obs64", "obs",
        "streamlabs", "xsplit",
        "davinci-resolve", "resolve",
        "premiere", "afterfx", "photoshop", "illustrator", "lightroom",
        "gimp", "inkscape", "blender",
        "krita", "paint.net", "pdn",
        "handbrake-handbrake", "handbrake",
        // === Escritório / PDF ===
        "outlook", "winword", "excel", "powerpnt", "onenote",
        "access", "visio", "project", "publisher",
        "SumatraPDF", "FoxitReader", "Acrobat", "AcrobatReader",
        "libreoffice", "openoffice", "wps",
        "wordpad", "notion", "evernote",
        // === Comunicação ===
        "Teams", "Slack", "Discord", "WhatsApp", "Telegram",
        "zoom", "skype", "signal", "mattermost",
        "element", "thunderbird", "messenger",
        "line", "wechat", "viber",
        "discordcanary", "discordptb",
        "mumble", "teampeak", "teamspeak3",
        // === Ferramentas Windows ===
        "notepad", "calc", "mspaint", "SnippingTool",
        "Magnify", "osk", " Narrator", "StikyNot",
        // === Utilidades ===
        "everything", "wox", "flowlauncher",
        "7zfm", "winrar", "winzip",
        "ccleaner", "revo",
        "hwmonitor", "cpuid", "gpuz",
        "corsair-icue", "icue", "lghub", "ghub", "steelseries",
        "logitech", "synapse",
        // === Antivírus / Segurança ===
        "msmpeng", "defender",
        "mbam", "mbamtray",
        "avast", "avg", "bitdefender", "kaspersky",
        "norton", "mcafee", "eset", "sophos",
        // === Launchers (janela em si, não o jogo) ===
        "steam", "steamwebhelper",
        "epicgameslauncher", "epicgames",
        "gog", "goggalaxy",
        "ubisoftconnect", "upc",
        "origin", "eadesktop",
        "battlenet", "agent",
        "leagueclientux", "riotclient",
        "minecraft launcher",
    };

    private void OnGameChanged(GameInfo game)
    {
        if (game.IsValid && !string.IsNullOrEmpty(game.ProcessName))
        {
            // Só atualiza _lastDetectedGame para jogos de verdade (não Electron, etc.)
            if (!NonGameProcesses.Contains(game.ProcessName))
                _lastDetectedGame = game;
        }

        // Se o foreground mudou para algo diferente do jogo que o usuário parou,
        // libera auto-start para qualquer jogo da próxima vez
        if (!string.IsNullOrEmpty(_userStoppedProcess) &&
            game.ProcessName != _userStoppedProcess)
        {
            _userStoppedProcess = "";
        }

        _status.Update(s =>
        {
            s.Game = game.IsValid && !NonGameProcesses.Contains(game.ProcessName) ? game.ToString() : null;
        });

        // GameAudioOnly: quando um jogo REAL muda durante gravação, atualiza filtro de áudio
        if (_config.Config.GameAudioOnly && _recording && game.IsValid && game.ProcessId > 0)
        {
            // Ignora processos não-jogo (explorer, navegadores, etc.)
            if (NonGameProcesses.Contains(game.ProcessName))
                return;

            // Evita restart se o filtro já estiver aplicado para este PID
            if (_appliedGameAudioOnly && _appliedGameAudioPid == game.ProcessId)
                return;

            Console.WriteLine($"[EngineCoordinator] GameAudioOnly: jogo mudou para '{game.ProcessName}' PID={game.ProcessId} — atualizando filtro");
            _appliedGameAudioOnly = true;
            _appliedGameAudioPid = game.ProcessId;
            ApplyAudioSessionsInternal([game.ProcessId]);
        }

        // Auto-stop: quando o jogo que iniciamos a captura fecha, para a gravação
        if (_recording && _capturedGameProcess != null &&
            game.ProcessName != _capturedGameProcess)
        {
            try
            {
                // Verifica se o processo do jogo ainda existe
                var procs = Process.GetProcessesByName(_capturedGameProcess);
                if (procs.Length == 0)
                {
                    Console.WriteLine($"[EngineCoordinator] Jogo '{_capturedGameProcess}' fechou — parando captura");
                    _capturedGameProcess = null;
                    StopCapture();
                }
            }
            catch { }
        }

        // Auto-start apenas quando um jogo REAL entra em foreground
        // e a captura ainda não está ativa. Enquanto captura estiver rodando
        // (DXGI desktop), alt-tab não interrompe — o monitor inteiro já está sendo gravado.
        if (game.IsValid && _config.Config.AutoStartCapture && !_captureActive)
        {
            if (NonGameProcesses.Contains(game.ProcessName))
                return;

            // Só auto-start para janelas em modo fullscreen (FSX ou FSO).
            // Janelas em modo Windowed (explorer, Code, VLC, etc.) NÃO disparam auto-start.
            if (game.DisplayMode != DisplayMode.FullscreenExclusive &&
                game.DisplayMode != DisplayMode.FullscreenOptimized)
            {
                return;
            }

            // Ignora classes de janela do sistema
            if (IsSystemWindowClass(game.WindowClass))
                return;

            // Ignora executáveis em diretórios do sistema (C:\Windows\, C:\Program Files\ não-jogo)
            if (IsSystemExecutablePath(game.ExecutablePath))
                return;

            // Se o usuário parou manualmente este mesmo jogo, não auto-start
            if (_userStoppedProcess == game.ProcessName)
                return;

            Console.WriteLine($"[EngineCoordinator] Auto-start capture for game '{game}' (autoStartCapture=true)");
            _capturedGameProcess = game.ProcessName;
            StartCapture();
        }
    }

    private void OnMicStateChanged(bool active)
    {
        if (_audioMixer != null)
            _audioMixer.MicEnabled = active;
        Console.WriteLine($"[EngineCoordinator] [pttEvent] Microfone (PTT): {(active ? "ATIVO" : "MUTO")}");
    }

    private static string NormalizePttMode(string mode)
    {
        return mode?.ToLowerInvariant() switch
        {
            "hold" => "Hold",
            "toggle" => "Toggle",
            _ => "Off",
        };
    }

    private bool _appliedGameAudioOnly;
    private int _appliedGameAudioPid;

    private void ApplyGameAudioOnly()
    {
        if (_config.Config.GameAudioOnly)
        {
            var game = _lastDetectedGame.IsValid ? _lastDetectedGame : _gameDetector.CurrentGame;
            if (game.IsValid && game.ProcessId > 0)
            {
                // Skip restart if already applied to the same PID
                if (_appliedGameAudioOnly && _appliedGameAudioPid == game.ProcessId)
                {
                    Console.WriteLine($"[EngineCoordinator] GameAudioOnly já aplicado para PID {game.ProcessId} — sem restart");
                    return;
                }

                Console.WriteLine($"[EngineCoordinator] GameAudioOnly ON — filtrando áudio para '{game.ProcessName}' PID={game.ProcessId}");
                _appliedGameAudioOnly = true;
                _appliedGameAudioPid = game.ProcessId;
                ApplyAudioSessionsInternal([game.ProcessId]);
            }
            else
            {
                Console.WriteLine("[EngineCoordinator] GameAudioOnly ON mas nenhum jogo detectado — mantendo áudio atual");
            }
        }
        else
        {
            // Skip restart if GameAudioOnly was already OFF
            if (!_appliedGameAudioOnly)
            {
                Console.WriteLine("[EngineCoordinator] GameAudioOnly já estava OFF — sem restart");
                return;
            }

            Console.WriteLine("[EngineCoordinator] GameAudioOnly OFF — restaurando áudio completo do sistema");
            _appliedGameAudioOnly = false;
            _appliedGameAudioPid = 0;
            ApplyAudioSessionsInternal([]);
        }
    }

    private void ApplyAudioSessionsInternal(List<int> pids)
    {
        _config.Update(c =>
        {
            if (pids.Count > 0)
            {
                var selectedPids = new Dictionary<int, string>();
                foreach (var pid in pids)
                {
                    try
                    {
                        var proc = Process.GetProcessById(pid);
                        selectedPids[pid] = proc.ProcessName;
                    }
                    catch
                    {
                        selectedPids[pid] = $"PID:{pid}";
                    }
                }
                c.SelectedAudioSessions = selectedPids;
            }
            else
            {
                c.SelectedAudioSessions = new Dictionary<int, string>();
            }
        });

        if (_recording)
            TryScheduleRestart("GameAudioOnly");
    }

    private void TryScheduleRestart(string reason)
    {
        lock (_restartLock)
        {
            if (_restartPending)
            {
                Console.WriteLine($"[EngineCoordinator] Restart já pendente — ignorando ({reason})");
                return;
            }
            _restartPending = true;
        }

        Console.WriteLine($"[EngineCoordinator] Reiniciando pipeline ({reason})...");
        _ = Task.Run(() =>
        {
            try
            {
                StopCapture();
                StartCapture();
            }
            finally
            {
                lock (_restartLock)
                    _restartPending = false;
            }
        });
    }

    private async Task<IpcMessage?> OnIpcMessage(IpcMessage msg)
    {
        // Lida com mensagens do Electron (spec seção 16)
        switch (msg.Action)
        {
            case "handshake":
                return new IpcMessage
                {
                    Action = "handshake_ack",
                    Value = JsonSerializer.SerializeToElement(new
                    {
                        engineVersion = "1.0.0",
                        status = "ok"
                    })
                };

            case "setReplayTime":
                if (msg.Value.HasValue)
                {
                    var secs = msg.Value.Value.GetInt32();
                    _config.Update(c => c.ReplayTimeSeconds = secs);
                }
                return new IpcMessage { Action = "ok" };

            case "startEngine":
                _ = StartAsync();
                return new IpcMessage { Action = "ok" };

            case "stopEngine":
                _ = StopAsync();
                return new IpcMessage { Action = "ok" };

            case "setCustomGameProcess":
                if (msg.Value.HasValue)
                {
                    try
                    {
                        var processName = msg.Value.Value.GetProperty("processName").GetString() ?? "";
                        _customGameProcess = processName;
                        Console.WriteLine($"[EngineCoordinator] Custom game process set to '{processName}'");
                    }
                    catch { /* ignore malformed */ }
                }
                return new IpcMessage { Action = "ok" };

            case "startCapture":
                if (_captureActive)
                {
                    Console.WriteLine("[EngineCoordinator] startCapture ignorado — captura já ativa");
                    return new IpcMessage { Action = "ok" };
                }
                if (msg.Value.HasValue)
                {
                    try
                    {
                        var gameProcess = msg.Value.Value.GetProperty("gameProcess").GetString();
                        if (!string.IsNullOrEmpty(gameProcess))
                        {
                            _pendingGameProcess = gameProcess;
                            Console.WriteLine($"[EngineCoordinator] startCapture pending game process '{gameProcess}'");
                        }
                    }
                    catch { /* gameProcess not provided */ }
                }
                StartCapture();
                return new IpcMessage
                {
                    Action = _captureActive ? "ok" : "error",
                    Value = _captureActive
                        ? null
                        : JsonSerializer.SerializeToElement(new { error = "Capture failed to start" })
                };

            case "stopCapture":
                StopCapture();
                return new IpcMessage { Action = "ok" };

            case "saveClip":
            {
                var stats = _buffer.Stats();
                Console.WriteLine($"[EngineCoordinator] saveClip: video={stats.videoCount} audio={stats.audioCount} " +
                    $"dur={stats.duration.TotalSeconds:F1}s bytes={stats.bytes} " +
                    $"recording={_recording} captureActive={_captureActive}");
                if (stats.videoCount == 0)
                {
                    return new IpcMessage
                    {
                        Action = "error",
                        Value = JsonSerializer.SerializeToElement(new { error = "Nothing to save (buffer empty)" })
                    };
                }
                return await SaveClipAndRespondAsync();
            }

            case "getStatus":
                return new IpcMessage
                {
                    Action = "status",
                    Value = JsonSerializer.SerializeToElement(GetStatusMessage())
                };

            case "getAudioSessions":
            {
                // Cache de 2s — Electron pode chamar em rapid succession
                long now = Stopwatch.GetTimestamp();
                if (_cachedAudioSessionsJson != null &&
                    (now - _audioSessionsCacheTicks) / Stopwatch.Frequency < 2)
                {
                    return new IpcMessage
                    {
                        Action = "audioSessions",
                        Value = JsonSerializer.Deserialize<JsonElement>(_cachedAudioSessionsJson)
                    };
                }

                var sessions = _audioSessions.EnumerateSessions();
                var sessionPids = new HashSet<int>(sessions.Select(s => s.ProcessId));
                var selectedPids = _config.Config.SelectedAudioSessions;

                // 1. Sessions WASAPI ativas
                var list = sessions.Select(s => new
                {
                    processId = s.ProcessId,
                    processName = s.ProcessName,
                    displayName = s.DisplayName,
                    isSelected = selectedPids.Count == 0 || selectedPids.ContainsKey(s.ProcessId),
                }).ToList();

                // 2. PIDs selecionados que estão vivos mas sem session WASAPI ativa
                if (selectedPids.Count > 0)
                {
                    foreach (var (pid, name) in selectedPids)
                    {
                        if (sessionPids.Contains(pid)) continue;
                        try
                        {
                            using var proc = Process.GetProcessById(pid);
                            if (!proc.HasExited)
                            {
                                sessionPids.Add(pid);
                                list.Add(new
                                {
                                    processId = pid,
                                    processName = proc.ProcessName,
                                    displayName = proc.ProcessName,
                                    isSelected = true,
                                });
                            }
                        }
                        catch { }
                    }
                }

                // 3. Todos os processos GUI com janela (captura apps como Discord que
                //    só criam sessão WASAPI quando em call de voz)
                try
                {
                    foreach (var proc in Process.GetProcesses())
                    {
                        try
                        {
                            // Pula system idle, sistema, e processos sem janela
                            if (proc.Id < 10) continue;
                            if (proc.SessionId == 0) continue;
                            if (!proc.Responding) continue;
                            if (proc.MainWindowHandle == IntPtr.Zero) continue;
                            if (string.IsNullOrEmpty(proc.ProcessName)) continue;
                            if (sessionPids.Contains(proc.Id)) continue;

                            sessionPids.Add(proc.Id);
                            list.Add(new
                            {
                                processId = proc.Id,
                                processName = proc.ProcessName,
                                displayName = proc.ProcessName,
                                isSelected = selectedPids.Count == 0 || selectedPids.ContainsKey(proc.Id),
                            });
                        }
                        catch { }
                    }
                }
                catch { }

                var rawJson = JsonSerializer.Serialize(new { sessions = list });
                _cachedAudioSessionsJson = rawJson;
                _audioSessionsCacheTicks = Stopwatch.GetTimestamp();

                return new IpcMessage
                {
                    Action = "audioSessions",
                    Value = JsonSerializer.Deserialize<JsonElement>(rawJson)
                };
            }

            case "setAudioSessions":
            {
                if (msg.Value.HasValue)
                {
                    // Electron sends { pids: [1234, 5678] }
                    var raw = msg.Value.Value.GetRawText();
                    var dict = JsonSerializer.Deserialize<Dictionary<string, List<int>>>(raw);
                    if (dict != null && dict.TryGetValue("pids", out var pids))
                    {
                        // Expande PIDs para incluir processos filhos (ex: FiveM → GTA5.exe)
                        // sem abrir handles nos filhos (anti-cheat como BattlEye detecta)
                        var (expanded, childToParent) = ExpandWithChildProcesses(pids);

                        // Resolve nomes apenas dos PIDs originais (já seguros, da UI)
                        var selectedPids = new Dictionary<int, string>();
                        foreach (var pid in pids)
                        {
                            try
                            {
                                var proc = Process.GetProcessById(pid);
                                selectedPids[pid] = proc.ProcessName;
                            }
                            catch
                            {
                                selectedPids[pid] = $"PID:{pid}";
                            }
                        }

                        // Processos filhos expandidos usam o nome do pai (sem abrir handle)
                        foreach (var (child, parent) in childToParent)
                        {
                            if (selectedPids.TryGetValue(parent, out var parentName))
                                selectedPids[child] = parentName;
                            else
                                selectedPids[child] = $"PID:{child}";
                        }
                        Console.WriteLine($"[EngineCoordinator] setAudioSessions: {selectedPids.Count} PIDs (expandido de {pids.Count}) — {string.Join(", ", selectedPids.Select(kv => $"{kv.Value}({kv.Key})"))}");
                        _config.Update(c => c.SelectedAudioSessions = selectedPids);

                        // Reinicia captura com novo filtro per-processo (PROCESS_LOOPBACK)
                    if (_recording)
                        TryScheduleRestart("setAudioSessions");
                        else
                        {
                            Console.WriteLine("[EngineCoordinator] Filtro salvo, mas captura não está ativa — será aplicado no próximo StartCapture");
                        }
                    }
                }
                return new IpcMessage { Action = "ok" };
            }

            case "config":
            {
                try
                {
                    if (!msg.Value.HasValue)
                        return new IpcMessage { Action = "ok" };

                    var cfgEl = msg.Value.Value;
                    // Electron envia { config: {...} } dentro do payload
                    if (cfgEl.TryGetProperty("config", out var inner))
                        cfgEl = inner;

                    var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                    var incoming = JsonSerializer.Deserialize<AppConfig>(cfgEl.GetRawText(), opts);
                    if (incoming != null)
                    {
                        var oldGameDetection = _config.Config.GameDetection;
                        var oldPttMode = NormalizePttMode(_config.Config.PttMode);

                        _config.Update(c =>
                        {
                            c.ReplayTimeSeconds = incoming.ReplayTimeSeconds;
                            c.MicEnabled = incoming.MicEnabled;
                            c.AudioSampleRate = incoming.AudioSampleRate;
                            c.MicVolume = incoming.MicVolume;
                            c.GameVolume = incoming.GameVolume;
                            c.Fps = incoming.Fps;
                            c.Width = incoming.Width;
                            c.Height = incoming.Height;
                            c.BitrateKbps = incoming.BitrateKbps;
                            c.OutputDirectory = incoming.OutputDirectory;
                            c.ForceSoftware = incoming.ForceSoftware;
                            c.HotkeyBindings = incoming.HotkeyBindings;
                            c.PushToTalkKeys = incoming.PushToTalkKeys;
                            c.PttMode = incoming.PttMode;
                            c.MicDeviceId = incoming.MicDeviceId;
                            c.AutoStartCapture = incoming.AutoStartCapture;
                            c.UseExcludeMode = incoming.UseExcludeMode;
                            c.ExcludeProcessId = incoming.ExcludeProcessId;
                            c.ElectronPid = incoming.ElectronPid;
							c.AudioLoopback = incoming.AudioLoopback;
							c.GameDetection = incoming.GameDetection;
							// GameAudioOnly vem do Electron: o frontend garante que
							// audioLoopback e gameAudioOnly são mutuamente exclusivos
							c.GameAudioOnly = incoming.GameAudioOnly;
                            c.NoiseSuppressionEnabled = incoming.NoiseSuppressionEnabled;
                            c.AutoCleanupEnabled = incoming.AutoCleanupEnabled;
                            c.AutoCleanupThresholdPercent = incoming.AutoCleanupThresholdPercent;
                            if (incoming.SelectedAudioSessions.Count > 0)
                                c.SelectedAudioSessions = incoming.SelectedAudioSessions;
                        });

                        // Aplica GameAudioOnly: auto-filtra áudio para só o jogo + mic
                        // Quando GameAudioOnly=true, C++ DLL captura só o PID do jogo
                        // Quando GameAudioOnly=false, pipeline reinicia com WasapiLoopbackSource
                        ApplyGameAudioOnly();

                        // Aplica GameDetection: liga/desliga o detector de jogos
                        if (incoming.GameDetection && !oldGameDetection)
                        {
                            Console.WriteLine("[EngineCoordinator] GameDetection ON — iniciando detector");
                            _gameDetector.Start();
                        }
                        else if (!incoming.GameDetection && oldGameDetection)
                        {
                            Console.WriteLine("[EngineCoordinator] GameDetection OFF — parando detector, limpando jogo atual");
                            _gameDetector.Stop();
                            _lastDetectedGame = new GameInfo();
                            _status.Update(s => s.Game = null);
                        }

                        ApplyHotkeyBindings();

                        // Aplica AutoCleanup: restart/stop timer
                        _cleanupTimer?.Change(Timeout.Infinite, Timeout.Infinite);
                        if (_config.Config.AutoCleanupEnabled)
                            _cleanupTimer?.Change(TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));

                        // Reconfigura PTT
                        _ptt.ClearKeys();
                        foreach (var vk in _config.Config.PushToTalkKeys)
                            _ptt.AddPttKey((VirtualKey)vk);
                        _ptt.Mode = NormalizePttMode(_config.Config.PttMode) switch
                        {
                            "Toggle" => PttMode.Toggle,
                            "Hold" => PttMode.Hold,
                            _ => PttMode.Off,
                        };

                        // Aplica noise suppression + gains no mixer (NÃO toca MicEnabled — PTT controla)
                        if (_audioMixer != null)
                        {
                            _audioMixer.NoiseSuppressionEnabled = _config.Config.NoiseSuppressionEnabled;
                            _audioMixer.GameGain = _config.Config.GameVolume;
                            _audioMixer.MicGain = _config.Config.MicVolume;
                            var newPttMode = NormalizePttMode(_config.Config.PttMode);
                            // Só muda MicEnabled se PTT mode foi desligado (Off) ou acabou de ser ligado
                            if (newPttMode is "Off" && oldPttMode is not "Off")
                            {
                                _audioMixer.MicEnabled = _config.Config.MicEnabled;
                                Console.WriteLine($"[EngineCoordinator] [cfgTrans→Off] MicEnabled={_audioMixer.MicEnabled}");
                            }
                            else if (newPttMode is not "Off" && oldPttMode is "Off")
                            {
                                _audioMixer.MicEnabled = false;
                                Console.WriteLine($"[EngineCoordinator] [cfgTrans→PTT] MicEnabled=false");
                            }
                            // Se PTT já estava ativo ou já estava Off: não mexe (PTT sistema controla)
                            Console.WriteLine($"[EngineCoordinator] Gains: game={_config.Config.GameVolume:F2} mic={_config.Config.MicVolume:F2} micEnabled={_audioMixer.MicEnabled} pttMode={newPttMode} (oldPtt={oldPttMode})");
                        }

                        // Propaga ElectronPid para o GameDetector (filtro de falsos foreground)
                        _gameDetector.SetElectronPid(_config.Config.ElectronPid);

                        Console.WriteLine("[EngineCoordinator] Config atualizada via pipe");
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[EngineCoordinator] Erro ao aplicar config: {ex.Message}");
                }
                return new IpcMessage { Action = "ok" };
            }

            case "getMicDevices":
            {
                Console.WriteLine($"[EngineCoordinator] getMicDevices: enumerating...");
                var list = EnumerateMicDevices();
                Console.WriteLine($"[EngineCoordinator] getMicDevices: returning {list.Count} devices");
                return new IpcMessage
                {
                    Action = "micDevices",
                    Value = JsonSerializer.SerializeToElement(new { devices = list })
                };
            }

            case "setMicDevice":
            {
                try
                {
                    if (msg.Value.HasValue)
                    {
                        var deviceId = msg.Value.Value.GetProperty("deviceId").GetString() ?? "";
                        _config.Update(c => c.MicDeviceId = deviceId);

                        // Se estiver capturando, recria o mic source com o novo device
                        if (_recording)
                        {
                            _audioMixer?.Stop();
                            _audioMixer?.Dispose();
                            _audioMixer = null;

                            if (_micSource != null)
                            {
                                _micSource.Stop();
                                _micSource.Dispose();
                                _micSource = null;
                            }

                            _audioMixer = CreateAudioMixer();
                            _audioMixer.MicEnabled = NormalizePttMode(_config.Config.PttMode) is "Hold" or "Toggle" ? false : _config.Config.MicEnabled;
                            Console.WriteLine($"[EngineCoordinator] [reinitMic] MicEnabled={_audioMixer.MicEnabled}");
                            _audioMixer.GameGain = _config.Config.GameVolume;
                            _audioMixer.MicGain = _config.Config.MicVolume;
                            _audioMixer.OnMixedAudio += OnAudioPacket;
                            _audioMixer.Start();
                        }

                        Console.WriteLine($"[EngineCoordinator] Mic device set to '{deviceId}'");
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[EngineCoordinator] Erro ao setar mic device: {ex.Message}");
                }
                return new IpcMessage { Action = "ok" };
            }

            case "getGpus":
            {
                var gpus = EncoderManager.GetGpuList();
                var items = gpus.Select(g => new { index = g.Index, name = g.Name, vendorId = g.VendorId }).ToList();
                return new IpcMessage
                {
                    Action = "gpuList",
                    Value = JsonSerializer.SerializeToElement(items)
                };
            }

            default:
                return new IpcMessage
                {
                    Action = "error",
                    Value = JsonSerializer.SerializeToElement(new { error = $"Unknown action: {msg.Action}" })
                };
        }
    }

    private EngineStatusMessage GetStatusMessage()
    {
        var s = _status.Current;
        return new EngineStatusMessage
        {
            Value = new EngineStatusValue
            {
                CaptureBackend = s.CaptureBackend,
                Encoder = s.Encoder,
                DiskSpaceOk = CheckDiskSpace(),
                LastCrashRecovered = s.LastCrashRecovered,
                Game = _gameDetector.CurrentGame.IsValid ? _gameDetector.CurrentGame.ToString() : null,
                Recording = _recording,
                UptimeSeconds = (long)_clock.Now.TotalSeconds,
                AudioFallback = _audioFallback,
                LastFrameMs = s.LastFrameMs,
                LastClipSize = s.LastClipSize,
                ActivePipelines = s.ActivePipelines,
                WatchdogOk = s.WatchdogOk,
                MemoryMB = s.MemoryMB,
                ReplayBufferBytes = s.ReplayBufferBytes,
                OutputDirectory = _config.Config.OutputDirectory,
            }
        };
    }

    private static bool CheckDiskSpace()
    {
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
            var drive = new DriveInfo(desktop);
            return drive.AvailableFreeSpace > 100_000_000;
        }
        catch
        {
            return true;
        }
    }

    /// <summary>
    /// Enumerates microphone devices on an STA thread (required by NAudio/COM MMDeviceEnumerator).
    /// If already on STA, runs inline; otherwise spawns a dedicated STA thread.
    /// </summary>
    private static List<object> EnumerateMicDevices()
    {
        // Need STA for NAudio COM MMDeviceEnumerator
        try
        {
            if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA)
                return EnumerateMicDevicesInner();
        }
        catch
        {
            // Unknown apartment state — run on dedicated STA thread
        }

        var result = new List<object>();
        var thread = new Thread(() =>
        {
            result = EnumerateMicDevicesInner();
        })
        {
            IsBackground = true,
            Name = "MicEnumSTA"
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!thread.Join(5000))
            Console.Error.WriteLine("[EngineCoordinator] MicEnumSTA thread timed out after 5s");
        return result;
    }

    private static List<object> EnumerateMicDevicesInner()
    {
        var list = new List<object>();
        try
        {
            using var enumerator = new NAudio.CoreAudioApi.MMDeviceEnumerator();
            Console.WriteLine($"[EngineCoordinator] EnumerateMicDevices: enumerator created (STA={Thread.CurrentThread.GetApartmentState()})");
            var devices = enumerator.EnumerateAudioEndPoints(
                NAudio.CoreAudioApi.DataFlow.Capture,
                NAudio.CoreAudioApi.DeviceState.Active);
            Console.WriteLine($"[EngineCoordinator] EnumerateMicDevices: found {devices.Count} devices");
            string defaultId;
            try
            {
                defaultId = enumerator.GetDefaultAudioEndpoint(
                    NAudio.CoreAudioApi.DataFlow.Capture,
                    NAudio.CoreAudioApi.Role.Communications)?.ID ?? "";
                Console.WriteLine($"[EngineCoordinator] EnumerateMicDevices: defaultId='{defaultId}'");
            }
            catch (Exception exDef)
            {
                Console.Error.WriteLine($"[EngineCoordinator] GetDefaultAudioEndpoint failed: {exDef.Message}");
                defaultId = "";
            }

            foreach (var dev in devices)
            {
                using (dev)
                {
                    Console.WriteLine($"[EngineCoordinator] EnumerateMicDevices: dev id='{dev.ID}' name='{dev.FriendlyName}'");
                    list.Add(new
                    {
                        id = dev.ID,
                        name = dev.FriendlyName,
                        isDefault = dev.ID == defaultId,
                        channels = 2,
                        sampleRate = 48000,
                    });
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[EngineCoordinator] Erro ao enumerar mics: {ex.Message}");
        }
        Console.WriteLine($"[EngineCoordinator] EnumerateMicDevices: returning {list.Count} devices");
        return list;
    }

    private void RunAutoCleanup()
    {
        try
        {
            if (!_config.Config.AutoCleanupEnabled)
                return;

            var dir = GetOutputDirectory();
            var drive = new DriveInfo(dir);
            var threshold = _config.Config.AutoCleanupThresholdPercent / 100.0;
            var restore = Math.Min(threshold - 0.05, 0.85);

            if (drive.AvailableFreeSpace >= drive.TotalSize * (1.0 - threshold))
                return;

            var favoriteMarkers = new HashSet<string>(
                Directory.GetFiles(dir, "*.favorite"),
                StringComparer.OrdinalIgnoreCase);

            var files = Directory.GetFiles(dir, "*.mp4")
                .Select(f => new FileInfo(f))
                .Where(f => !favoriteMarkers.Contains(Path.GetFileNameWithoutExtension(f.Name)))
                .OrderBy(f => f.CreationTime)
                .ToList();

            long deleted = 0;
            foreach (var file in files)
            {
                if (drive.AvailableFreeSpace >= drive.TotalSize * (1.0 - restore))
                    break;
                try
                {
                    file.Delete();
                    deleted += file.Length;
                }
                catch { }
            }

            if (deleted > 0)
                Console.Error.WriteLine($"[Cleanup] Removidos {deleted / (1024 * 1024)} MB em clips antigos (threshold={_config.Config.AutoCleanupThresholdPercent}%)");
        }
        catch { }
    }

    private void BroadcastStatus(EngineStatusMessage msg)
    {
        OnStatusChanged?.Invoke(msg.Value);
    }

    private int _lastCropX, _lastCropY, _lastCropW, _lastCropH;

    private void UpdateDxgiCropRect()
    {
        var game = ResolveTargetGame();
        int cropX = 0, cropY = 0, cropW = 0, cropH = 0;

        if (game.IsValid && game.Hwnd != IntPtr.Zero && DwmGetWindowAttribute(game.Hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out var rect, Marshal.SizeOf<RECT>()) == 0)
        {
            var hMon = MonitorHelper.GetMonitorFromWindowHandle(game.Hwnd);
            var (mLeft, mTop, mRight, mBottom) = MonitorHelper.GetMonitorRect(hMon);

            cropW = rect.Right - rect.Left;
            cropH = rect.Bottom - rect.Top;
            if (cropW > 0 && cropH > 0)
            {
                var clampedLeft = Math.Max(rect.Left, mLeft);
                var clampedTop = Math.Max(rect.Top, mTop);
                var clampedRight = Math.Min(rect.Right, mRight);
                var clampedBottom = Math.Min(rect.Bottom, mBottom);
                cropW = (clampedRight - clampedLeft) & ~1;
                cropH = (clampedBottom - clampedTop) & ~1;
                cropX = clampedLeft - mLeft;
                cropY = clampedTop - mTop;
                Console.WriteLine($"[UpdateDxgiCropRect] window={rect.Left}:{rect.Top}:{rect.Right}:{rect.Bottom} monitor={mLeft}:{mTop}:{mRight}:{mBottom} clamped={clampedLeft}:{clampedTop}:{clampedRight}:{clampedBottom} crop={cropX}:{cropY}:{cropW}:{cropH}");

                // Crop muito pequeno: GpuVideoConverter falha com E_INVALIDARG e ffmpeg produz output vazio.
                // Ignora crop e usa quadro completo quando abaixo de 320x240.
                if (cropW > 0 && (cropW < 320 || cropH < 240))
                {
                    Console.WriteLine($"[UpdateDxgiCropRect] Crop muito pequeno ({cropW}x{cropH}) — usando quadro completo");
                    cropW = 0;
                    cropH = 0;
                }
            }
        }

        if (_encoder != null && (cropX != _lastCropX || cropY != _lastCropY || cropW != _lastCropW || cropH != _lastCropH))
        {
            _encoder.SetCropRect(cropX, cropY, cropW, cropH);

            // Se crop cobre a tela inteira (crop=source=no-op), não precisa restartar ffmpeg
            bool isNoop = cropW == _captureWidth && cropH == _captureHeight && cropX == 0 && cropY == 0;
            if (!isNoop)
            {
                Console.Error.WriteLine($"[UpdateDxgiCropRect] Crop real: {_lastCropX},{_lastCropY},{_lastCropW},{_lastCropH} → {cropX},{cropY},{cropW},{cropH}. Chamando Flush()...");
                _encoder.Flush();
            }
            else
            {
                Console.WriteLine($"[UpdateDxgiCropRect] Crop no-op (tela inteira) — Flush ignorado");
            }

            _lastCropX = cropX; _lastCropY = cropY; _lastCropW = cropW; _lastCropH = cropH;
        }
    }

    public void Dispose()
    {
        StopCapture();
        _hotkeys.Dispose();
        _gameDetector.Dispose();
        _buffer.Dispose();
        _audioSessions.Dispose();
        _exporter.Dispose();
        _pipeServer.Dispose();
        _config.Dispose();
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    /// <summary>
    /// Expande uma lista de PIDs incluindo processos filhos via Toolhelp32Snapshot.
    /// Retorna (todos os PIDs, mapeamento child→parent para resolver nomes sem abrir handles).
    /// </summary>
    private static (HashSet<int>, Dictionary<int, int>) ExpandWithChildProcesses(IEnumerable<int> pids)
    {
        var result = new HashSet<int>(pids);
        var childToParent = new Dictionary<int, int>();
        try
        {
            var snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == INVALID_HANDLE_VALUE) return (result, childToParent);

            try
            {
                var entry = new PROCESSENTRY32 { dwSize = Marshal.SizeOf<PROCESSENTRY32>() };
                if (!Process32First(snapshot, ref entry))
                    return (result, childToParent);

                var parentMap = new Dictionary<int, int>();
                do
                {
                    parentMap[entry.th32ProcessID] = entry.th32ParentProcessID;
                }
                while (Process32Next(snapshot, ref entry));

                // BFS: para cada PID selecionado, adiciona todos os descendentes
                var queue = new Queue<int>(result);
                while (queue.Count > 0)
                {
                    var pid = queue.Dequeue();
                    foreach (var (child, parent) in parentMap)
                    {
                        if (parent == pid && result.Add(child))
                        {
                            childToParent[child] = pid;
                            queue.Enqueue(child);
                        }
                    }
                }
            }
            finally
            {
                CloseHandle(snapshot);
            }
        }
        catch { }
        return (result, childToParent);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESSENTRY32
    {
        public int dwSize;
        public int cntUsage;
        public int th32ProcessID;
        public nint th32DefaultHeapID;
        public int th32ModuleID;
        public int cntThreads;
        public int th32ParentProcessID;
        public int pcPriClassBase;
        public int dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new(-1);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    /// <summary>
    /// Thread STA dedicada com message pump para WGC.
    /// WinRT GraphicsCapture precisa que a thread que criou a sessão
    /// bombeie mensagens Windows para o DWM entregar frames.
    /// </summary>
    private sealed class WindowsMessagePump : IDisposable
    {
        private Thread _pumpThread = null!;
        private readonly ConcurrentQueue<Action> _actions = new();
        private readonly object _threadLock = new();
        private volatile bool _disposed;
        private volatile bool _threadAlive;

        public WindowsMessagePump()
        {
            StartThread();
        }

        private void StartThread()
        {
            lock (_threadLock)
            {
                _pumpThread = new Thread(PumpLoop)
                {
                    Name = "WgcMessagePump",
                    IsBackground = true
                };
                _pumpThread.SetApartmentState(ApartmentState.STA);
                _threadAlive = true;
                _pumpThread.Start();
            }
        }

        public void Invoke(Action action)
        {
            if (_disposed)
                throw new InvalidOperationException("WGC pump disposed");
            if (!_threadAlive)
            {
                lock (_threadLock)
                {
                    if (!_threadAlive)
                        StartThread();
                }
            }
            if (Thread.CurrentThread == _pumpThread)
            {
                action();
                return;
            }
            var mre = new ManualResetEventSlim(false);
            Exception? exception = null;
            _actions.Enqueue(() =>
            {
                try
                {
                    action();
                }
                catch (Exception ex)
                {
                    exception = ex;
                }
                finally
                {
                    try { mre.Set(); } catch { /* ignorar se MRE já descartado */ }
                }
            });
            PostMessage(IntPtr.Zero, 0, IntPtr.Zero, IntPtr.Zero);
            if (!mre.Wait(5000))
            {
                _threadAlive = false;
                throw new InvalidOperationException("WGC pump timeout");
            }
            if (exception != null)
                throw new InvalidOperationException("WGC init no pump falhou", exception);
        }

        private void PumpLoop()
        {
            try { RoInitialize(0); } catch { }
            try
            {
                while (!_disposed)
                {
                    try
                    {
                        while (PeekMessage(out var msg, IntPtr.Zero, 0, 0, PM_REMOVE))
                        {
                            TranslateMessage(ref msg);
                            DispatchMessage(ref msg);
                        }
                        while (_actions.TryDequeue(out var action))
                            action();
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[WgcMessagePump] Loop error: {ex.Message}");
                    }
                    if (!_disposed)
                        Thread.Sleep(1);
                }
            }
            finally
            {
                _threadAlive = false;
            }
        }

        public void Dispose()
        {
            _disposed = true;
            _pumpThread.Join(2000);
        }

        private const uint PM_REMOVE = 1;

        [DllImport("combase.dll", PreserveSig = false)]
        private static extern void RoInitialize(uint initType);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern nint DispatchMessage(ref MSG lpMsg);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern short TranslateMessage(ref MSG lpMsg);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern nint PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int ptX;
            public int ptY;
        }
    }
}
