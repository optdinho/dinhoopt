using DiNho.Capture.Poc.GameDetection;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.System.Diagnostics.ToolHelp;
using Windows.Win32.UI.WindowsAndMessaging;

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
            if (_captureTargetHwnd != IntPtr.Zero && IsTargetProcessAlive())
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

    // ---------------------------------------------------------------------------
    // Alive-check por PID via OpenProcess (Opção A — fix do falso-negativo FiveM).
    // O nome do processo do FiveM inclui o build number (FiveM_b3258_GTAProcess),
    // que muda a cada atualização — Process.GetProcessesByName faz match exato e
    // o jogo parecia "morto" estando vivo. OpenProcess por PID é robusto a isso.
    // Seam estático para testes determinísticos (default = P/Invoke real).
    // ---------------------------------------------------------------------------

    internal const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    internal const uint ERROR_ACCESS_DENIED = 5;
    internal const uint STILL_ACTIVE = 259;

    // Campos (não auto-properties) para reflexão por nome nos testes.
    internal static Func<uint, bool> IsProcessAliveProbe = IsProcessAliveCore;
    internal static Func<uint, IntPtr> OpenProcessProbe = pid =>
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true, EntryPoint = "OpenProcess")]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true, EntryPoint = "GetExitCodeProcess")]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true, EntryPoint = "CloseHandle")]
    private static extern bool CloseHandle(IntPtr hObject);

    // Retorna true se o processo ainda está vivo. Fail-closed: em caso de dúvida
    // (exceção, sem acesso de leitura), assume vivo — nunca derruba captura por engano.
    private static bool IsProcessAlive(int pid)
    {
        if (pid <= 0)
            return false;
        try
        {
            return IsProcessAliveProbe((uint)pid);
        }
        catch (Exception ex)
        {
            Log.W("EngineCoordinator", $"IsProcessAlive(pid={pid}) falhou — assumindo vivo: {ex.Message}");
            return true;
        }
    }

    private static bool IsProcessAliveCore(uint pid)
    {
        IntPtr handle = OpenProcessProbe(pid);
        if (handle == IntPtr.Zero)
        {
            // Sem acesso de query (ex: processo de outro usuário) ainda é "vivo".
            var err = System.Runtime.InteropServices.Marshal.GetLastWin32Error();
            if (err == ERROR_ACCESS_DENIED)
                return true;
            return false;
        }

        try
        {
            // Handle aberto: o processo existe no momento. GetExitCodeProcess com
            // STILL_ACTIVE (259) confirma que ainda está rodando; qualquer outra
            // leitura não-confiável assume vivo (fail-closed).
            if (GetExitCodeProcess(handle, out uint code))
                return code == STILL_ACTIVE;
            return true;
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    // Normaliza nome de processo: remove sufixo .exe e o build number do FiveM
    // ("FiveM_b3258_GTAProcess" → "FiveM_GTAProcess"). Vazio/whitespace → "".
    internal static string NormalizeProcessName(string? processName)
    {
        var name = processName?.Trim();
        if (string.IsNullOrEmpty(name))
            return "";
        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            name = name[..^4];
        return System.Text.RegularExpressions.Regex.Replace(name, @"_b\d+_", "_", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    }

    private static bool IsProcessAlive(string processName)
    {
        try
        {
            var name = NormalizeProcessName(processName);
            if (name.Length == 0)
                return false;
            var procs = Process.GetProcessesByName(name);
            bool alive = procs.Length > 0;
            foreach (var p in procs) p.Dispose();
            return alive;
        }
        catch (Exception ex)
        {
            // Fail-closed: exceção na checagem nunca derruba captura por engano.
            Log.W("EngineCoordinator", $"IsProcessAlive('{processName}') falhou — assumindo vivo: {ex.Message}");
            return true;
        }
    }

    // Check de vida do jogo alvo da captura: usa PID quando disponível
    // (robusto ao build number do FiveM), senão cai no fallback por nome (fuzzy).
    private bool IsTargetProcessAlive()
    {
        if (_captureTargetGame.ProcessId > 0)
            return IsProcessAlive(_captureTargetGame.ProcessId);
        return IsProcessAlive(_captureTargetGame.ProcessName);
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
            {
                var info = BuildGameInfoFromProcess(procs[0]);
                for (int i = 0; i < procs.Length; i++) procs[i].Dispose();
                return info;
            }

            // 2) Fuzzy match: strip build-number segments (e.g. _b3258_) then compare
            //    "FiveM_b3258_GTAProcess" → "FiveM_GTAProcess" after normalization
            var normalizedBase = System.Text.RegularExpressions.Regex.Replace(baseName, @"_b\d+_", "_", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            foreach (var proc in System.Diagnostics.Process.GetProcesses())
            {
                try
                {
                    var normalizedProc = System.Text.RegularExpressions.Regex.Replace(proc.ProcessName, @"_b\d+_", "_", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                    if (normalizedProc.Contains(normalizedBase, StringComparison.OrdinalIgnoreCase))
                    {
                        var info = BuildGameInfoFromProcess(proc);
                        proc.Dispose();
                        return info;
                    }
                    proc.Dispose();
                }
                    catch (Exception ex) { Log.D("EngineCoordinator", $"ResolveProcessByName: error inspecting process '{proc.ProcessName}': {ex.Message}"); try { proc.Dispose(); } catch { /* dispose failure is non-critical */ } }
            }
        }
        catch (Exception ex) { Log.D("EngineCoordinator", $"ResolveProcessByName failed for '{processName}': {ex.Message}"); }

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

    private static unsafe IntPtr FindWindowByProcessId(int processId)
    {
        IntPtr foundVisible = IntPtr.Zero;
        IntPtr foundAny = IntPtr.Zero;
        PInvoke.EnumWindows((hwnd, _) =>
        {
            uint pid;
            PInvoke.GetWindowThreadProcessId(hwnd, &pid);
            if (pid == (uint)processId)
            {
                if (PInvoke.IsWindowVisible(hwnd))
                {
                    foundVisible = (IntPtr)hwnd;
                    return false;
                }
                if (foundAny == IntPtr.Zero)
                    foundAny = (IntPtr)hwnd;
            }
            return true;
        }, default);
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
        catch (Exception ex) { Log.D("EngineCoordinator", $"IsSystemExecutablePath failed: {ex.Message}"); }

        return false;
    }

    private static IntPtr GetDesktopWindow()
    {
        return (IntPtr)PInvoke.GetDesktopWindow();
    }

    private static bool IsWindowValidForWgc(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        if (hwnd == (IntPtr)PInvoke.GetDesktopWindow())
        {
            Log.I("EngineCoordinator", "Desktop window — WGC per-window não funcionará, pulando para desktop capture");
            return false;
        }
        if (!PInvoke.IsWindowVisible((HWND)hwnd)) return false;
        if (PInvoke.IsIconic((HWND)hwnd)) return false;
        var exStyle = PInvoke.GetWindowLong((HWND)hwnd, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE);
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
                // Verifica se o processo do jogo ainda existe.
                // Usa PID primeiro (robusto ao build number do FiveM), senão o nome.
                bool alive = _capturedGameProcessId > 0
                    ? IsProcessAlive(_capturedGameProcessId)
                    : IsProcessAlive(_capturedGameProcess);
                if (!alive)
                {
                    Log.I("EngineCoordinator", $"Jogo '{_capturedGameProcess}' fechou — parando captura");
                    _capturedGameProcess = null;
                    _capturedGameProcessId = 0;
                    StopCapture();
                }
            }
            catch (Exception ex) { Log.D("EngineCoordinator", $"auto-stop check failed for '{_capturedGameProcess}': {ex.Message}"); }        }

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
            _capturedGameProcessId = game.ProcessId;
            StartCapture();
        }
    }

    // Find all direct child processes of a given PID using CreateToolhelp32Snapshot
    private static unsafe HashSet<int> GetChildProcesses(int parentPid)
    {
        var children = new HashSet<int>();
        HANDLE snapshot = PInvoke.CreateToolhelp32Snapshot(CREATE_TOOLHELP_SNAPSHOT_FLAGS.TH32CS_SNAPPROCESS, 0);
        if (snapshot == (HANDLE)(nint)(-1))
            return children;

        try
        {
            var entry = new PROCESSENTRY32W();
            entry.dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32W>();

            if (PInvoke.Process32FirstW(snapshot, &entry))
            {
                do
                {
                    if (entry.th32ParentProcessID == parentPid && entry.th32ProcessID != parentPid)
                        children.Add((int)entry.th32ProcessID);
                } while (PInvoke.Process32NextW(snapshot, &entry));
            }
        }
        finally
        {
            PInvoke.CloseHandle(snapshot);
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

    private const uint WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
}
