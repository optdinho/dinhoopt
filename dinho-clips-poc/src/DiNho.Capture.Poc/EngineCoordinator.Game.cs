using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
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
                Log.I("EngineCoordinator", $"Target game '{_captureTargetGame.ProcessName}' → HWND 0x{resolved.Hwnd:X8}");
                return resolved;
            }

            // Processo vivo mas sem MainWindowHandle (ex: minimizado)
            // Usa o HWND salvo original como fallback
            if (_captureTargetHwnd != IntPtr.Zero && IsProcessAlive(_captureTargetGame.ProcessName))
            {
                Log.I("EngineCoordinator", $"Target game '{_captureTargetGame.ProcessName}' vivo mas sem HWND — usando HWND salvo 0x{_captureTargetHwnd:X8}");
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
            Log.I("EngineCoordinator", $"Target game '{_captureTargetGame.ProcessName}' morreu — resolvendo novo alvo");
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
                Log.I("EngineCoordinator", $"Pending game '{result.ProcessName}' → HWND 0x{result.Hwnd:X8}");
                return result;
            }
        }

        // Custom game process (seleção manual) tem prioridade
        if (!string.IsNullOrEmpty(_customGameProcess))
        {
            var result = ResolveProcessByName(_customGameProcess);
            if (result.IsValid)
            {
                Log.I("EngineCoordinator", $"Custom game '{_customGameProcess}' → HWND 0x{result.Hwnd:X8}");
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
                Log.I("EngineCoordinator", $"Fallback para último jogo '{_lastDetectedGame.ProcessName}' → HWND 0x{fallback.Hwnd:X8}");
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

        var baseName = System.IO.Path.GetFileNameWithoutExtension(procName);

        try
        {
            // 1) Exact match first
            var procs = System.Diagnostics.Process.GetProcessesByName(baseName);
            if (procs.Length > 0)
                return BuildGameInfoFromProcess(procs[0]);

            // 2) Fuzzy match: strip build-number segments (e.g. _b3258_) then compare
            //    "FiveM_b3258_GTAProcess" → "FiveM_GTAProcess" after normalization
            var normalizedBase = System.Text.RegularExpressions.Regex.Replace(baseName, @"_b\d+_", "_", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            foreach (var proc in System.Diagnostics.Process.GetProcesses())
            {
                try
                {
                    var normalizedProc = System.Text.RegularExpressions.Regex.Replace(proc.ProcessName, @"_b\d+_", "_", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                    if (normalizedProc.Contains(normalizedBase, StringComparison.OrdinalIgnoreCase))
                        return BuildGameInfoFromProcess(proc);
                }
                catch { }
            }
        }
        catch { }

        return new GameInfo();
    }

    private static GameInfo BuildGameInfoFromProcess(System.Diagnostics.Process proc)
    {
        var hwnd = proc.MainWindowHandle;

        // Se MainWindowHandle é Zero (ex: jogo minimizado),
        // tenta EnumWindows para encontrar a janela pelo PID
        if (hwnd == IntPtr.Zero)
            hwnd = FindWindowByProcessId(proc.Id);

        return new GameDetection.GameInfo(
            processName: proc.ProcessName,
            executablePath: proc.MainModule?.FileName ?? "",
            windowTitle: hwnd != IntPtr.Zero ? proc.MainWindowTitle : "",
            windowClass: "",
            displayMode: GameDetection.DisplayMode.Unknown,
            processId: proc.Id,
            hwnd: hwnd
        );
    }

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

    private static bool IsWindowValidForWgc(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        // Desktop window pseudo-HWND (0x00010010) não funciona com WGC per-window
        if (hwnd == GetDesktopWindow())
        {
            Log.I("EngineCoordinator", "Desktop window — WGC per-window não funcionará, pulando para desktop capture");
            return false;
        }
        if (!IsWindowVisible(hwnd)) return false;
        if (IsIconic(hwnd)) return false;
        var exStyle = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if ((exStyle & WS_EX_NOREDIRECTIONBITMAP) != 0)
        {
            Log.I("EngineCoordinator", $"Janela 0x{hwnd:X8} tem WS_EX_NOREDIRECTIONBITMAP — WGC per-window não funcionará");
            return false;
        }
        return true;
    }

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

            Log.I("EngineCoordinator", $"GameAudioOnly: jogo mudou para '{game.ProcessName}' PID={game.ProcessId} — atualizando filtro");
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
                    Log.I("EngineCoordinator", $"Jogo '{_capturedGameProcess}' fechou — parando captura");
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

            Log.I("EngineCoordinator", $"Auto-start capture for game '{game}' (autoStartCapture=true)");
            _capturedGameProcess = game.ProcessName;
            StartCapture();
        }
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
        "dxdiag", "winver", "mstsc",         "powershell_ise", "wsl", "bash",
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
        "Magnify", "osk", "Narrator", "StikyNot",
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

    // Win32 P/Invoke declarations
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

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
}
