using System.Text.Json;
using System.Text.Json.Serialization;
using DiNho.Capture.Poc.Hotkeys;

namespace DiNho.Capture.Poc.Config;

public sealed class HotkeyBinding
{
    public int Vk { get; set; } = 0x77;
    public List<int> Modifiers { get; set; } = new();
    public string Action { get; set; } = "SaveClip";
    public int? ReplayDurationSeconds { get; set; }
    public bool Enabled { get; set; } = true;
}

public sealed class AppConfig
{
    [JsonPropertyName("Hotkeys")]
    public List<HotkeyBinding> HotkeyBindings { get; set; } = new()
    {
        new() { Vk = 0x77, Action = "SaveClip", Enabled = true },
        new() { Vk = 0x78, Action = "ToggleCapture", Enabled = true },
        new() { Vk = 0x79, Action = "ToggleMic", Enabled = true },
    };

    // Sessões de áudio selecionadas (PID -> nome)
    public Dictionary<int, string> SelectedAudioSessions { get; set; } = new();

    // PTT keys (lista de VK codes)
    public List<int> PushToTalkKeys { get; set; } = new() { 0x77 }; // F8 default

    // Replay (fallback global, sobrescrito por binding.DurationSeconds se existir)
    public int ReplayTimeSeconds { get; set; } = 300; // 5 min

    // Audio
    public bool MicEnabled { get; set; } = true;
    public int AudioSampleRate { get; set; } = 48000;
    public float MicVolume { get; set; } = 1.0f;
    public float GameVolume { get; set; } = 1.0f;

    // Video
    public int Fps { get; set; } = 60;
    public int Width { get; set; } = 1920;
    public int Height { get; set; } = 1080;
    public int BitrateKbps { get; set; } = 20000;

    // Paths
    public string OutputDirectory { get; set; } = "";

    // PTT mode: "Hold" or "Toggle" or "Off"
    [JsonPropertyName("pushToTalk")]
    public string PttMode { get; set; } = "Hold";

    // Forçar encoder software (útil para testes sem GPU / WARP)
    public bool ForceSoftware { get; set; } = false;

    // Dispositivo de microfone selecionado (vazio = padrão)
    public string MicDeviceId { get; set; } = "";

    // Auto-start capture when game is detected
    public bool AutoStartCapture { get; set; } = false;

    // EXCLUDE mode: captura TODO áudio do sistema exceto ExcludeProcessId
    public bool UseExcludeMode { get; set; } = false;

    // PID a excluir no EXCLUDE mode (ex: PID do Electron)
    public int ExcludeProcessId { get; set; } = 0;

    /// <summary>
    /// Retorna a maior duração de replay necessária com base
    /// no global ReplayTimeSeconds e em todos os bindings ativos.
    /// </summary>
    [JsonIgnore]
    public int EffectiveReplaySeconds
    {
        get
        {
            int max = ReplayTimeSeconds;
            foreach (var b in HotkeyBindings)
                if (b.Enabled && b.ReplayDurationSeconds.HasValue && b.ReplayDurationSeconds.Value > max)
                    max = b.ReplayDurationSeconds.Value;
            return max;
        }
    }
}

public sealed class ConfigManager : IDisposable
{
    private readonly string _configDir;
    private readonly string _configPath;
    private readonly AppConfig _defaults = new();
    private readonly object _lock = new();

    public AppConfig Config { get; private set; }

    // Evento disparado quando config muda em runtime
    public event Action<AppConfig>? OnConfigChanged;

    public ConfigManager(string? configPath = null)
    {
        if (configPath != null)
        {
            _configPath = configPath;
            _configDir = Path.GetDirectoryName(configPath)!;
        }
        else
        {
            _configDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "DiNhoClips");
            _configPath = Path.Combine(_configDir, "config.json");
        }
        Config = Load();
    }

    public AppConfig Load()
    {
        try
        {
            if (!File.Exists(_configPath))
            {
                SaveToDisk(_defaults);
                return CloneConfig(_defaults);
            }

            var json = File.ReadAllText(_configPath);
            var config = JsonSerializer.Deserialize<AppConfig>(json);

            // Migração: config antigo com campos fixos → bindings dinâmicos
            if (config != null && config.HotkeyBindings.Count == 3 &&
                config.HotkeyBindings[0].Vk == 0x77 &&
                config.HotkeyBindings[0].Action == "SaveClip")
            {
                // Já é o novo formato, ok
            }
            else if (config != null)
            {
                // Tenta ler do formato antigo via JsonDocument
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (root.TryGetProperty("SaveClipVk", out var oldSave))
                {
                    var bindings = new List<HotkeyBinding>
                    {
                        new() { Vk = oldSave.GetInt32(), Action = "SaveClip", Enabled = true },
                    };
                    if (root.TryGetProperty("ToggleCaptureVk", out var oldCap))
                        bindings.Add(new() { Vk = oldCap.GetInt32(), Action = "ToggleCapture", Enabled = true });
                    if (root.TryGetProperty("ToggleMicVk", out var oldMic))
                        bindings.Add(new() { Vk = oldMic.GetInt32(), Action = "ToggleMic", Enabled = true });
                    config.HotkeyBindings = bindings;
                    config.ReplayTimeSeconds = root.TryGetProperty("ReplayTimeSeconds", out var oldDur)
                        ? oldDur.GetInt32() : 300;
                    Console.Error.WriteLine("[Config] Migrado formato antigo para bindings dinâmicos");
                    SaveToDisk(config);
                }
            }
            if (config == null)
            {
                Console.Error.WriteLine("[Config] Arquivo corrompido, revertendo para defaults");
                SaveToDisk(_defaults);
                return CloneConfig(_defaults);
            }

            // Valida campos críticos
            if (config.ReplayTimeSeconds < 30 || config.ReplayTimeSeconds > 600)
                config.ReplayTimeSeconds = _defaults.ReplayTimeSeconds;

            if (config.Fps is not (30 or 60 or 75 or 120 or 144))
                config.Fps = _defaults.Fps;

            if (config.AudioSampleRate is not (44100 or 48000 or 96000))
                config.AudioSampleRate = _defaults.AudioSampleRate;

            if (config.Width < 640 || config.Width > 7680 || config.Height < 480 || config.Height > 4320)
            {
                config.Width = _defaults.Width;
                config.Height = _defaults.Height;
            }

            if (config.BitrateKbps < 500 || config.BitrateKbps > 200_000)
                config.BitrateKbps = _defaults.BitrateKbps;

            if (config.MicVolume < 0f || config.MicVolume > 2f)
                config.MicVolume = _defaults.MicVolume;

            if (config.PttMode is not ("Hold" or "Toggle"))
                config.PttMode = _defaults.PttMode;

            // Valida diretório de saída
            if (!string.IsNullOrEmpty(config.OutputDirectory))
            {
                try
                {
                    if (!Directory.Exists(config.OutputDirectory))
                        Directory.CreateDirectory(config.OutputDirectory);
                }
                catch
                {
                    config.OutputDirectory = "";
                }
            }

            return config;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[Config] Erro ao carregar: {ex.Message}, revertendo para defaults");
            return CloneConfig(_defaults);
        }
    }

    public void Save()
    {
        lock (_lock)
        {
            SaveToDisk(Config);
        }
    }

    private void SaveToDisk(AppConfig config)
    {
        try
        {
            if (!Directory.Exists(_configDir))
                Directory.CreateDirectory(_configDir);

            var json = JsonSerializer.Serialize(config, new JsonSerializerOptions
            {
                WriteIndented = true
            });
            File.WriteAllText(_configPath, json);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[Config] Erro ao salvar: {ex.Message}");
        }
    }

    public void Update(Action<AppConfig> updater)
    {
        lock (_lock)
        {
            updater(Config);
            SaveToDisk(Config);
        }
        OnConfigChanged?.Invoke(Config);
    }

    // Valida se o diretório de saída existe e tem permissão de escrita
    public static bool ValidateOutputDirectory(string path, out string? error)
    {
        error = null;
        try
        {
            if (string.IsNullOrEmpty(path))
            {
                error = "Caminho não pode ser vazio";
                return false;
            }

            if (!Directory.Exists(path))
                Directory.CreateDirectory(path);

            var testFile = Path.Combine(path, ".dinho_write_test");
            File.WriteAllText(testFile, "test");
            File.Delete(testFile);

            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }

    private static AppConfig CloneConfig(AppConfig source)
    {
        return JsonSerializer.Deserialize<AppConfig>(
            JsonSerializer.Serialize(source)) ?? new AppConfig();
    }

    public void Dispose()
    {
    }
}
