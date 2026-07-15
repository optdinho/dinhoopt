using DiNho.Capture.Poc.Logging;
using Microsoft.Win32;
using System.Text.Json;

namespace DiNho.Capture.Poc.GameDetection;

/// <summary>
/// Escaneia bibliotecas de jogos instalados (Steam + Epic Games)
/// e retorna processName → displayName para fallback no GameDatabase.
/// </summary>
public static class LibraryScanner
{
    private static readonly Dictionary<string, string> _scannedGames = new(StringComparer.OrdinalIgnoreCase);
    private static volatile bool _scanned;

    public static IReadOnlyDictionary<string, string> ScannedGames => _scannedGames;

    /// <summary>
    /// Escaneia Steam e Epic libraries. Resultado cacheado — múltiplas chamadas são no-ops.
    /// </summary>
    public static void Scan()
    {
        if (_scanned) return;
        lock (_scannedGames)
        {
            if (_scanned) return;

            try { ScanSteam(); }
            catch (Exception ex) { Log.E("LibraryScanner", $"Steam scan failed: {ex.Message}"); }

            try { ScanEpic(); }
            catch (Exception ex) { Log.E("LibraryScanner", $"Epic scan failed: {ex.Message}"); }

            _scanned = true;
            Log.I("LibraryScanner", $"Scanned: {_scannedGames.Count} games from Steam/Epic libraries");
        }
    }

    private static void ScanSteam()
    {
        var steamPath = FindSteamPath();
        if (steamPath == null)
        {
            Log.I("LibraryScanner", "Steam not found in registry");
            return;
        }

        var libraryFoldersPath = Path.Combine(steamPath, "steamapps", "libraryfolders.vdf");
        if (!File.Exists(libraryFoldersPath))
        {
            Log.I("LibraryScanner", $"libraryfolders.vdf not found at {libraryFoldersPath}");
            return;
        }

        var libraryFolders = ParseLibraryFoldersVdf(libraryFoldersPath);

        // Adicionar o diretório base do Steam
        var baseSteamApps = Path.Combine(steamPath, "steamapps");
        if (!libraryFolders.Contains(baseSteamApps, StringComparer.OrdinalIgnoreCase))
            libraryFolders.Insert(0, baseSteamApps);

        foreach (var libraryFolder in libraryFolders)
        {
            var commonDir = Path.Combine(libraryFolder, "common");
            if (!Directory.Exists(commonDir))
                continue;

            try
            {
                foreach (var gameDir in Directory.GetDirectories(commonDir))
                {
                    var gameName = Path.GetFileName(gameDir);
                    if (string.IsNullOrEmpty(gameName))
                        continue;

                    // Procurar executáveis principais no diretório do jogo
                    var exeFiles = Directory.GetFiles(gameDir, "*.exe");
                    foreach (var exePath in exeFiles)
                    {
                        var processName = Path.GetFileNameWithoutExtension(exePath);
                        if (string.IsNullOrEmpty(processName))
                            continue;

                        // Usar nome do diretório como displayName (ex: "Counter-Strike 2")
                        if (!_scannedGames.ContainsKey(processName))
                        {
                            _scannedGames[processName] = gameName;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log.E("LibraryScanner", $"Error scanning {commonDir}: {ex.Message}");
            }
        }
    }

    private static void ScanEpic()
    {
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var launcherInstalled = Path.Combine(programData, "Epic", "UnrealEngineLauncher", "LauncherInstalled.dat");

        if (!File.Exists(launcherInstalled))
        {
            Log.I("LibraryScanner", $"LauncherInstalled.dat not found at {launcherInstalled}");
            return;
        }

        try
        {
            var json = File.ReadAllText(launcherInstalled);
            var data = JsonSerializer.Deserialize<JsonElement>(json);

            if (data.TryGetProperty("InstallationList", out var installList) && installList.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in installList.EnumerateArray())
                {
                    if (!item.TryGetProperty("InstallLocation", out var locProp))
                        continue;

                    var installLocation = locProp.GetString();
                    if (string.IsNullOrEmpty(installLocation) || !Directory.Exists(installLocation))
                        continue;

                    // Procurar executáveis no diretório de instalação
                    try
                    {
                        var exeFiles = Directory.GetFiles(installLocation, "*.exe");
                        foreach (var exePath in exeFiles)
                        {
                            var processName = Path.GetFileNameWithoutExtension(exePath);
                            if (string.IsNullOrEmpty(processName))
                                continue;

                            // Usar nome do diretório como displayName
                            var gameName = Path.GetFileName(installLocation);
                            if (!_scannedGames.ContainsKey(processName))
                            {
                                _scannedGames[processName] = gameName;
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Log.E("LibraryScanner", $"Error scanning Epic game {installLocation}: {ex.Message}");
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Log.E("LibraryScanner", $"Failed to parse LauncherInstalled.dat: {ex.Message}");
        }
    }

    private static string? FindSteamPath()
    {
        // Tentar chaves de registro (64-bit e 32-bit)
        string[] registryPaths =
        [
            @"SOFTWARE\WOW6432Node\Valve\Steam",
            @"SOFTWARE\Valve\Steam"
        ];

        foreach (var regPath in registryPaths)
        {
            try
            {
                using var key = Registry.LocalMachine.OpenSubKey(regPath);
                if (key?.GetValue("InstallPath") is string installPath && Directory.Exists(installPath))
                {
                    return installPath;
                }
            }
            catch { /* ignorar erros de registro */ }
        }

        // Fallback: procurar em caminhos comuns
        string[] commonPaths =
        [
            @"C:\Program Files (x86)\Steam",
            @"C:\Program Files\Steam",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Steam"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Steam")
        ];

        foreach (var path in commonPaths)
        {
            if (Directory.Exists(path) && File.Exists(Path.Combine(path, "steam.exe")))
            {
                return path;
            }
        }

        return null;
    }

    /// <summary>
    /// Parse básico do libraryfolders.vdf para extrair caminhos de bibliotecas.
    /// Formato Valve Key-Value: "libraryfolders" { "0" { "path" "C:\\..." } ... }
    /// </summary>
    private static List<string> ParseLibraryFoldersVdf(string vdfPath)
    {
        var paths = new List<string>();
        var lines = File.ReadAllLines(vdfPath);

        foreach (var line in lines)
        {
            var trimmed = line.Trim();
            // Procurar por linhas com "path" "valor"
            if (trimmed.StartsWith("\"path\"", StringComparison.OrdinalIgnoreCase))
            {
                var parts = trimmed.Split('"', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 2)
                {
                    var path = parts[1].Replace("\\\\", "\\").Replace("\\", "\\");
                    if (Directory.Exists(path))
                    {
                        paths.Add(path);
                    }
                }
            }
        }

        return paths;
    }

    /// <summary>
    /// Retorna GameEntry synthetizado para um processo escaneado.
    /// </summary>
    public static GameEntry? LookupProcessName(string processName)
    {
        if (!_scanned) Scan();

        if (_scannedGames.TryGetValue(processName, out var displayName))
        {
            return new GameEntry
            {
                ProcessName = processName,
                DisplayName = displayName,
                WindowClass = "", // Não conhecido para jogos escaneados
                Aliases = [displayName],
                Backends = ["wgc", "dxgi"]
            };
        }

        return null;
    }
}
