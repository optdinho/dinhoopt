using System.Text.Json;

namespace DiNho.Capture.Poc.GameDetection;

public class GameEntry
{
    [System.Text.Json.Serialization.JsonPropertyName("processName")]
    public string ProcessName { get; set; } = "";
    [System.Text.Json.Serialization.JsonPropertyName("windowClass")]
    public string WindowClass { get; set; } = "";
    [System.Text.Json.Serialization.JsonPropertyName("displayName")]
    public string DisplayName { get; set; } = "";
    [System.Text.Json.Serialization.JsonPropertyName("aliases")]
    public List<string> Aliases { get; set; } = [];
    [System.Text.Json.Serialization.JsonPropertyName("backends")]
    public List<string> Backends { get; set; } = [];
}

public class GameDatabase
{
    [System.Text.Json.Serialization.JsonPropertyName("version")]
    public int Version { get; set; }
    [System.Text.Json.Serialization.JsonPropertyName("games")]
    public List<GameEntry> Games { get; set; } = [];

    private Dictionary<string, GameEntry> _byWindowClass = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, GameEntry> _byProcessName = new(StringComparer.OrdinalIgnoreCase);
    private bool _loaded;

    private static readonly Lazy<GameDatabase> _instance = new(() => new GameDatabase());
    public static GameDatabase Instance => _instance.Value;

    public bool IsLoaded => _loaded;
    public int GameCount => _loaded ? Games.Count : 0;

    public void Load(string? jsonPath = null)
    {
        if (_loaded) return;

        // Try provided path, then executable directory, then fallback paths
        var candidates = new List<string>();
        if (!string.IsNullOrEmpty(jsonPath))
            candidates.Add(jsonPath);

        var baseDir = AppContext.BaseDirectory;
        candidates.Add(Path.Combine(baseDir, "games.json"));

        // Also try project root for development
        var projectRoot = Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", ".."));
        candidates.Add(Path.Combine(projectRoot, "dinho-clips-poc", "src", "DiNho.Capture.Poc", "games.json"));
        candidates.Add(Path.Combine(projectRoot, "games.json"));

        foreach (var candidate in candidates)
        {
            try
            {
                if (File.Exists(candidate))
                {
                    var json = File.ReadAllText(candidate);
                    var db = JsonSerializer.Deserialize<GameDatabase>(json);
                    if (db?.Games != null && db.Games.Count > 0)
                    {
                        Games = db.Games;
                        Version = db.Version;
                        BuildIndexes();
                        _loaded = true;
                        Console.WriteLine($"[GameDatabase] Loaded {Games.Count} games from {candidate}");
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[GameDatabase] Failed to load {candidate}: {ex.Message}");
            }
        }

        Console.Error.WriteLine("[GameDatabase] No games.json found, using hardcoded fallback");
    }

    private void BuildIndexes()
    {
        _byWindowClass.Clear();
        _byProcessName.Clear();

        foreach (var game in Games)
        {
            if (!string.IsNullOrEmpty(game.WindowClass))
            {
                // Only first entry per windowClass wins
                _byWindowClass.TryAdd(game.WindowClass, game);
            }

            if (!string.IsNullOrEmpty(game.ProcessName))
            {
                _byProcessName.TryAdd(game.ProcessName, game);
            }
        }
    }

    public string? FindDisplayNameByWindowClass(string windowClass)
    {
        return _byWindowClass.TryGetValue(windowClass, out var game) ? game.DisplayName : null;
    }

    public GameEntry? FindByProcessName(string processName)
    {
        return _byProcessName.TryGetValue(processName, out var game) ? game : null;
    }

    public GameEntry? FindByAlias(string alias)
    {
        return Games.Find(g =>
            g.Aliases.Exists(a => string.Equals(a, alias, StringComparison.OrdinalIgnoreCase)));
    }

    public GameEntry? FindByAny(string? windowClass, string? processName)
    {
        if (!string.IsNullOrEmpty(windowClass))
        {
            var byClass = FindDisplayNameByWindowClass(windowClass);
            if (byClass != null)
                return _byWindowClass[windowClass];
        }

        if (!string.IsNullOrEmpty(processName))
        {
            var byProcess = FindByProcessName(processName);
            if (byProcess != null)
                return byProcess;

            var byAlias = FindByAlias(processName);
            if (byAlias != null)
                return byAlias;
        }

        return null;
    }

    // Hardcoded fallback map (same as original KnownGames)
    private static readonly Dictionary<string, string> HardcodedMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["grcWindow"] = "FiveM",
        ["WINDOW"] = "Roblox",
        ["SDL_app"] = "CS2/Source Engine",
        ["CEF-OSC-WIDGET"] = "Valorant",
        ["UnrealWindow"] = "Unreal Engine",
        ["UnityWndClass"] = "Unity",
        ["FORTNITE"] = "Fortnite",
    };

    public string GetDisplayName(string windowClass)
    {
        if (_loaded)
        {
            var name = FindDisplayNameByWindowClass(windowClass);
            if (name != null)
                return name;
        }

        return HardcodedMap.TryGetValue(windowClass, out var fallback) ? fallback : "";
    }
}
