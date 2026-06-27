using DiNho.Capture.Poc.Logging;
using System.Text.Json;
using System.Net.Http;

namespace DiNho.Capture.Poc.GameDetection;

public sealed class GameDatabaseUpdater
{
    public const string REMOTE_URL = "https://cdn.dinho.app/games.json";
    public const int CHECK_INTERVAL_DAYS = 7;
    private const string STATE_FILE = "games-update-check.json";

    private static readonly Lazy<GameDatabaseUpdater> _instance = new(() => new GameDatabaseUpdater());
    public static GameDatabaseUpdater Instance => _instance.Value;

    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly HttpClient _httpClient;
    private string _outputDirectory = AppContext.BaseDirectory;

    public GameDatabaseUpdater() : this(CreateDefaultHttpClient()) { }

    internal GameDatabaseUpdater(HttpClient httpClient, string? outputDirectory = null)
    {
        _httpClient = httpClient;
        if (outputDirectory != null)
            _outputDirectory = outputDirectory;
    }

    private static HttpClient CreateDefaultHttpClient()
    {
        var client = new HttpClient();
        client.DefaultRequestHeaders.UserAgent.ParseAdd("DiNhoOptimizer/1.0");
        client.DefaultRequestHeaders.Add("Accept", "application/json");
        return client;
    }

    public async Task<bool> CheckForUpdateAsync()
    {
        if (!await _lock.WaitAsync(0))
        {
            Log.I("GameDatabaseUpdater", "Update check already in progress, skipping");
            return false;
        }

        try
        {
            var state = LoadState();

            if (state != null && !IsDueForCheck(state))
            {
                Log.I("GameDatabaseUpdater", $"Last check was {(DateTime.UtcNow - DateTimeOffset.FromUnixTimeMilliseconds(state.LastCheckUnixMs).UtcDateTime).TotalDays:F1}d ago, skipping (interval: {CHECK_INTERVAL_DAYS}d)");
                return false;
            }

            Log.I("GameDatabaseUpdater", $"Checking for updates from {REMOTE_URL}");
            HttpResponseMessage response;
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                response = await _httpClient.GetAsync(REMOTE_URL, cts.Token);
                response.EnsureSuccessStatusCode();
            }
            catch (Exception ex)
            {
                Log.W("GameDatabaseUpdater", $"HTTP request failed: {ex.Message}");
                SaveState(new UpdateState { LastCheckUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), LastVersion = state?.LastVersion ?? 0 });
                return false;
            }

            string json;
            try
            {
                json = await response.Content.ReadAsStringAsync();
            }
            catch (Exception ex)
            {
                Log.W("GameDatabaseUpdater", $"Failed to read response content: {ex.Message}");
                SaveState(new UpdateState { LastCheckUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), LastVersion = state?.LastVersion ?? 0 });
                return false;
            }

            RemoteGameDatabase? remoteDb;
            try
            {
                remoteDb = JsonSerializer.Deserialize<RemoteGameDatabase>(json);
            }
            catch (Exception ex)
            {
                Log.W("GameDatabaseUpdater", $"Failed to parse remote games.json: {ex.Message}");
                SaveState(new UpdateState { LastCheckUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), LastVersion = state?.LastVersion ?? 0 });
                return false;
            }

            if (remoteDb?.Games == null || remoteDb.Games.Count == 0)
            {
                Log.W("GameDatabaseUpdater", "Remote games.json has no games entries");
                SaveState(new UpdateState { LastCheckUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), LastVersion = state?.LastVersion ?? 0 });
                return false;
            }

            var localVersion = GameDatabase.Instance.IsLoaded ? GameDatabase.Instance.Version : (state?.LastVersion ?? 0);

            if (remoteDb.Version <= localVersion)
            {
                Log.I("GameDatabaseUpdater", $"Remote version {remoteDb.Version} <= local version {localVersion}, no update needed");
                SaveState(new UpdateState { LastCheckUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), LastVersion = localVersion });
                return false;
            }

            var targetPath = Path.Combine(_outputDirectory, "games.json");
            try
            {
                await File.WriteAllTextAsync(targetPath, json);
            }
            catch (Exception ex)
            {
                Log.W("GameDatabaseUpdater", $"Failed to write updated games.json: {ex.Message}");
                SaveState(new UpdateState { LastCheckUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), LastVersion = localVersion });
                return false;
            }

            GameDatabase.Instance.Reload(targetPath);

            SaveState(new UpdateState { LastCheckUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), LastVersion = remoteDb.Version });
            Log.I("GameDatabaseUpdater", $"Updated games.json to version {remoteDb.Version} ({remoteDb.Games.Count} games)");
            return true;
        }
        finally
        {
            _lock.Release();
        }
    }

    private UpdateState? LoadState()
    {
        var path = Path.Combine(_outputDirectory, STATE_FILE);
        try
        {
            if (File.Exists(path))
            {
                var json = File.ReadAllText(path);
                return JsonSerializer.Deserialize<UpdateState>(json);
            }
        }
        catch (Exception ex)
        {
            Log.W("GameDatabaseUpdater", $"Failed to load state file: {ex.Message}");
        }
        return null;
    }

    private void SaveState(UpdateState state)
    {
        var path = Path.Combine(_outputDirectory, STATE_FILE);
        try
        {
            var json = JsonSerializer.Serialize(state);
            File.WriteAllText(path, json);
        }
        catch (Exception ex)
        {
            Log.W("GameDatabaseUpdater", $"Failed to save state file: {ex.Message}");
        }
    }

    private static bool IsDueForCheck(UpdateState state)
    {
        var lastCheck = DateTimeOffset.FromUnixTimeMilliseconds(state.LastCheckUnixMs).UtcDateTime;
        return (DateTime.UtcNow - lastCheck).TotalDays >= CHECK_INTERVAL_DAYS;
    }

    private sealed class RemoteGameDatabase
    {
        [System.Text.Json.Serialization.JsonPropertyName("version")]
        public int Version { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("games")]
        public List<object>? Games { get; set; }
    }

    public sealed class UpdateState
    {
        [System.Text.Json.Serialization.JsonPropertyName("lastCheckUnixMs")]
        public long LastCheckUnixMs { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("lastVersion")]
        public int LastVersion { get; set; }
    }
}
