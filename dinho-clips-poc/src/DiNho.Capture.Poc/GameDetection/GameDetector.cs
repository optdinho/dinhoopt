using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace DiNho.Capture.Poc.GameDetection;

public static class KnownGames
{
    /// <summary>
    /// Returns known display name for a window class.
    /// Checks GameDatabase first (JSON), falls back to hardcoded map.
    /// </summary>
    public static string LookupWindowClass(string windowClass)
    {
        return GameDatabase.Instance.GetDisplayName(windowClass);
    }

    /// <summary>
    /// Returns known display name for a process name (via JSON database).
    /// </summary>
    public static string? LookupProcessName(string processName)
    {
        var entry = GameDatabase.Instance.FindByProcessName(processName);
        return entry?.DisplayName;
    }

    /// <summary>
    /// Legacy compatibility: original hardcoded map.
    /// </summary>
    [Obsolete("Use LookupWindowClass instead, which checks GameDatabase first.")]
    public static readonly Dictionary<string, string> WindowClassMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["grcWindow"] = "FiveM",
        ["WINDOW"] = "Roblox",
        ["SDL_app"] = "CS2/Source Engine",
        ["CEF-OSC-WIDGET"] = "Valorant",
        ["UnrealWindow"] = "Unreal Engine",
        ["UnityWndClass"] = "Unity",
        ["FORTNITE"] = "Fortnite",
    };

    static KnownGames()
    {
        // Try to load game database on first access
        GameDatabase.Instance.Load();
    }
}

// <summary>
// Modo de exibição do jogo - usado para decidir DXGI vs WGC (spec seção 4.1)
// </summary>
public enum DisplayMode
{
    Unknown,
    FullscreenExclusive,  // Janela ocupa monitor inteiro + sem bordas + sem título
    FullscreenOptimized,  // Borderless fullscreen (maioria dos jogos modernos)
    Windowed              // Janela com bordas / não maximizada
}

public sealed class GameDetector : IDisposable
{
    private IntPtr _winEventHook;
    private Thread? _hookThread;
    private volatile bool _running;
    private IntPtr _lastForegroundHwnd;
    private Timer? _fallbackTimer;
    private WinEventDelegate? _winEventDelegate; // Mantido como field para evitar GC
    private int _electronPid;

    // Eventos
    public event Action<GameInfo>? OnGameChanged;

    private volatile GameInfo _currentGame = new();
    public GameInfo CurrentGame => _currentGame;
    private void SetCurrentGame(GameInfo value) => _currentGame = value;

    // Constantes WinEvent
    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint WINEVENT_OUTOFCONTEXT = 0;
    private const uint WINEVENT_SKIPOWNPROCESS = 2;

    public GameDetector()
    {
    }

    public void SetElectronPid(int pid)
    {
        _electronPid = pid;
    }

    public void Start()
    {
        if (_running) return;
        _running = true;

        // Tenta hook primeiro (SetWinEventHook precisa de thread STA com message pump)
        _hookThread = new Thread(HookThreadProc)
        {
            Name = "GameDetectorHook",
            IsBackground = true
        };
        _hookThread.SetApartmentState(ApartmentState.STA);
        _hookThread.Start();
    }

    public void Stop()
    {
        _running = false;

        if (_winEventHook != IntPtr.Zero)
        {
            UnhookWinEvent(_winEventHook);
            _winEventHook = IntPtr.Zero;
        }

        _hookThread?.Join(1000);
        _hookThread = null;

        _fallbackTimer?.Dispose();
        _fallbackTimer = null;
    }

    private void HookThreadProc()
    {
        // Salva como field para evitar GC do delegate nativo
        _winEventDelegate = OnForegroundChangedNative;

        _winEventHook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            IntPtr.Zero,
            _winEventDelegate,
            0, 0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
        );

        if (_winEventHook == IntPtr.Zero)
        {
            // Hook falhou — fallback para polling
            Log.W("GameDetector", "SetWinEventHook falhou, usando polling fallback");
            _fallbackTimer = new Timer(PollForeground, null, 0, 1000);
            return;
        }

        Log.I("GameDetector", $"SetWinEventHook OK ({(long)_winEventHook:X})");

        // Detecção inicial na hora
        var hwnd = GetForegroundWindow();
        if (hwnd != IntPtr.Zero)
            OnForegroundChanged(hwnd);

        // Message pump — necessário para o hook entregar callbacks
        while (_running)
        {
            while (PeekMessage(out var msg, IntPtr.Zero, 0, 0, PM_REMOVE) != 0)
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
            // Evita busy-wait
            if (_running)
                Thread.Sleep(50);
        }

        // Limpeza do hook
        if (_winEventHook != IntPtr.Zero)
        {
            UnhookWinEvent(_winEventHook);
            _winEventHook = IntPtr.Zero;
        }
    }

    // Callback nativo do SetWinEventHook — converte para managed call
    private void OnForegroundChangedNative(
        IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
    {
        OnForegroundChanged(hwnd);
    }

    private void OnForegroundChanged(IntPtr hwnd)
    {
        if (hwnd == Interlocked.CompareExchange(ref _lastForegroundHwnd, IntPtr.Zero, IntPtr.Zero) && hwnd != IntPtr.Zero)
            return;

        Interlocked.Exchange(ref _lastForegroundHwnd, hwnd);
        if (hwnd == IntPtr.Zero)
        {
            SetCurrentGame(new GameInfo());
            OnGameChanged?.Invoke(CurrentGame);
            return;
        }

        // Ignora foreground changes do próprio Electron (que rouba foco indevidamente)
        if (_electronPid > 0)
        {
            GetWindowThreadProcessId(hwnd, out var foregroundPid);
            if (foregroundPid == _electronPid)
                return;
        }

        var gameInfo = DetectGame(hwnd);
        SetCurrentGame(gameInfo);
        OnGameChanged?.Invoke(gameInfo);
    }

    // Polling fallback (usado se SetWinEventHook falhar)
    private void PollForeground(object? state)
    {
        if (!_running) return;
        var hwnd = GetForegroundWindow();
        if (hwnd == Interlocked.CompareExchange(ref _lastForegroundHwnd, IntPtr.Zero, IntPtr.Zero) && hwnd != IntPtr.Zero)
            return;

        Interlocked.Exchange(ref _lastForegroundHwnd, hwnd);
        if (hwnd == IntPtr.Zero)
        {
            SetCurrentGame(new GameInfo());
            OnGameChanged?.Invoke(CurrentGame);
            return;
        }

        if (_electronPid > 0)
        {
            GetWindowThreadProcessId(hwnd, out var foregroundPid);
            if (foregroundPid == _electronPid)
                return;
        }

        var gameInfo = DetectGame(hwnd);
        SetCurrentGame(gameInfo);
        OnGameChanged?.Invoke(gameInfo);
    }

    private static GameInfo DetectGame(IntPtr hwnd)
    {
        // 1. Pega o PID da janela
        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == 0)
            return new GameInfo();

        // 2. Pega nome do processo e executável
        string processName = "";
        string executablePath = "";
        try
        {
            var proc = Process.GetProcessById((int)pid);
            processName = proc.ProcessName;
            executablePath = proc.MainModule?.FileName ?? "";
        }
        catch
        {
            processName = "unknown";
        }

        // 3. Window class (útil para detectar FiveM, Roblox, etc.)
        var classBuilder = new System.Text.StringBuilder(256);
        GetClassName(hwnd, classBuilder, classBuilder.Capacity);
        var windowClass = classBuilder.ToString();

        // 4. Detecta modo de exibição
        var displayMode = DetectDisplayMode(hwnd);

        // 5. Título da janela
        int titleLen = GetWindowTextLength(hwnd);
        var titleBuilder = new System.Text.StringBuilder(titleLen + 1);
        GetWindowText(hwnd, titleBuilder, titleBuilder.Capacity);
        var windowTitle = titleBuilder.ToString();

        return new GameInfo(
            processName: processName,
            executablePath: executablePath,
            windowTitle: windowTitle,
            windowClass: windowClass,
            displayMode: displayMode,
            processId: (int)pid,
            hwnd: hwnd
        );
    }

    // Detecta se é fullscreen exclusivo, borderless ou windowed
    // Lógica: compara rect da janela com rect do monitor
    // Se a janela cobre o monitor inteiro e não tem borda visível → fullscreen
    // Se cobre mas tem borda → borderless/otimizado
    // Senão → windowed
    private static DisplayMode DetectDisplayMode(IntPtr hwnd)
    {
        // Pega o monitor onde a janela está
        var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        var monitorInfo = new MONITORINFO();
        monitorInfo.cbSize = Marshal.SizeOf<MONITORINFO>();
        GetMonitorInfo(monitor, ref monitorInfo);

        // Pega rect da janela
        GetWindowRect(hwnd, out var windowRect);

        var monitorRect = monitorInfo.rcMonitor;
        var style = GetWindowLong(hwnd, GWL_STYLE);

        bool hasBorder = (style & WS_CAPTION) != 0;
        bool coversMonitor =
            windowRect.Left <= monitorRect.Left &&
            windowRect.Top <= monitorRect.Top &&
            windowRect.Right >= monitorRect.Right &&
            windowRect.Bottom >= monitorRect.Bottom;

        if (coversMonitor && !hasBorder)
            return DisplayMode.FullscreenExclusive;
        if (coversMonitor && hasBorder)
            return DisplayMode.FullscreenOptimized;

        return DisplayMode.Windowed;
    }

    // --- P/Invokes (WinEvent) ---
    private delegate void WinEventDelegate(
        IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(
        uint eventMin, uint eventMax, IntPtr hmodWinEventProc,
        WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

    // --- P/Invokes (Message Pump) ---
    [DllImport("user32.dll", SetLastError = true)]
    private static extern int PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern nint DispatchMessage(ref MSG lpMsg);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int TranslateMessage(ref MSG lpMsg);

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

    private const uint PM_REMOVE = 1;

    // --- P/Invokes (originais) ---
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    private const int GWL_STYLE = -16;
    private const uint WS_CAPTION = 0x00C00000;
    private const uint MONITOR_DEFAULTTONEAREST = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    public void Dispose()
    {
        Stop();
    }
}

// <summary>
// Informações sobre o jogo atual em foreground
// </summary>
public sealed class GameInfo
{
    public string ProcessName { get; }
    public string ExecutablePath { get; }
    public string WindowTitle { get; }
    public string WindowClass { get; }
    public string KnownGame { get; }
    public DisplayMode DisplayMode { get; }
    public int ProcessId { get; }
    public IntPtr Hwnd { get; }
    public bool IsValid => !string.IsNullOrEmpty(ProcessName) && ProcessName != "unknown";

    public GameInfo()
    {
        ProcessName = "";
        ExecutablePath = "";
        WindowTitle = "";
        WindowClass = "";
        KnownGame = "";
        DisplayMode = DisplayMode.Unknown;
        ProcessId = 0;
        Hwnd = IntPtr.Zero;
    }

    public GameInfo(string processName, string executablePath, string windowTitle,
        string windowClass, DisplayMode displayMode, int processId, IntPtr hwnd)
    {
        ProcessName = processName;
        ExecutablePath = executablePath;
        WindowTitle = windowTitle;
        WindowClass = windowClass;
        KnownGame = KnownGames.LookupWindowClass(windowClass);
        if (string.IsNullOrEmpty(KnownGame))
        {
            var byProcess = KnownGames.LookupProcessName(processName);
            if (byProcess != null)
                KnownGame = byProcess;
            else
            {
                var entry = GameDatabase.Instance.FindByAlias(processName);
                if (entry != null)
                    KnownGame = entry.DisplayName;
            }
        }
        if (string.IsNullOrEmpty(KnownGame))
        {
            KnownGame = "";
        }
        DisplayMode = displayMode;
        ProcessId = processId;
        Hwnd = hwnd;
    }

    public override string ToString()
    {
        var mode = DisplayMode switch
        {
            DisplayMode.FullscreenExclusive => "FSX",
            DisplayMode.FullscreenOptimized => "FSO",
            DisplayMode.Windowed => "WIN",
            _ => "???"
        };
        var tag = !string.IsNullOrEmpty(KnownGame) ? $" ({KnownGame})" : "";
        return $"{ProcessName}{tag} [{mode}]";
    }
}
