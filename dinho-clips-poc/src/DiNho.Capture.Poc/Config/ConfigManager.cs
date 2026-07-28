using DiNho.Capture.Poc.Logging;
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
    // Nota: Electron pode enviar como number[] (ex: [1234, 5678]) em vez de Dictionary<int,string>
    // O JsonConverter abaixo trata ambos os formatos silenciosamente
    [JsonConverter(typeof(IntStringDictionaryConverter))]
    public Dictionary<int, string> SelectedAudioSessions { get; set; } = new();

    // PTT keys (lista de VK codes)
    public List<int> PushToTalkKeys { get; set; } = new() { 0x77 }; // F8 default

    // Replay (fallback global, sobrescrito por binding.DurationSeconds se existir)
    public int ReplayTimeSeconds { get; set; } = 120; // 2 min

    // Post-clip buffer: continua gravando N segundos após o save trigger
    // para garantir que o momento não seja cortado (ex: Medal/ShadowPlay)
    public int PostClipDurationSeconds { get; set; } = 5;

    // Audio
    public bool MicEnabled { get; set; } = true;
    public int AudioSampleRate { get; set; } = 48000;
    public float MicVolume { get; set; } = 1.0f;
    public float GameVolume { get; set; } = 1.0f;

    // Video
    public int Fps { get; set; } = 30;
    public int Width { get; set; } = 1920;
    public int Height { get; set; } = 1080;
    public int BitrateKbps { get; set; } = 40000;

    // CRF+VBV quality params (usados por NVENC/AV1)
    public int Cq { get; set; } = 22;
    public int MaxrateKbps { get; set; } = 30000;
    public int BufsizeKbps { get; set; } = 60000;
    public int Bframes { get; set; } = 3;
    public int Lookahead { get; set; } = 32;
    public string EncoderPreset { get; set; } = "p4";
    public string Codec { get; set; } = "auto";
    /// <summary>GPU adapter index for multi-GPU systems (-1 = auto).</summary>
    public int AdapterIndex { get; set; } = -1;

    // Paths
    public string OutputDirectory { get; set; } = "";

    // PTT mode: "Hold" or "Toggle" or "Off"
    [JsonPropertyName("pushToTalk")]
    public string PttMode { get; set; } = "Hold";

    // Forçar encoder software (útil para testes sem GPU / WARP)
    public bool ForceSoftware { get; set; } = false;

    // RNNoise/anlmdn noise suppression on microphone
    [JsonPropertyName("noiseSuppression")]
    public bool NoiseSuppressionEnabled { get; set; } = false;

    // Dispositivo de microfone selecionado (vazio = padrão)
    public string MicDeviceId { get; set; } = "";

    // Auto-start capture when game is detected
    public bool AutoStartCapture { get; set; } = true;

    // EXCLUDE mode: captura TODO áudio do sistema exceto ExcludeProcessId
    public bool UseExcludeMode { get; set; } = false;

    // PID a excluir no EXCLUDE mode (ex: PID do Electron)
    public int ExcludeProcessId { get; set; } = 0;

    // Game Audio Only: captura apenas áudio do jogo detectado + microfone
    public bool GameAudioOnly { get; set; } = true;

    // Audio Loopback: captura áudio do sistema (true) ou apenas microfone (false)
    public bool AudioLoopback { get; set; } = false;

    // RAM-aware adaptive quality (true = RamManager ajusta CQ/resolução/replay conforme RAM disponível)
    [JsonPropertyName("adaptiveQuality")]
    public bool AdaptiveQualityEnabled { get; set; } = true;

    // PID do processo Electron (para ignorar foreground changes quando o Electron rouba o foco)
    public int ElectronPid { get; set; }

    // Game Detection: detecta jogos em foreground (true) ou desliga o detector (false)
    public bool GameDetection { get; set; } = true;

    // AutoCleanup: remove clips antigos quando o disco está cheio
    public bool AutoCleanupEnabled { get; set; } = true;

    // Limite em GB de espaço total que o usuário quer usar para clips (ex: 20 = limpa quando clips > 20GB)
    public int AutoCleanupThresholdGB { get; set; } = 20;

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
            var config = JsonSerializer.Deserialize<AppConfig>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

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
                    Log.I("Config", "Migrado formato antigo para bindings dinâmicos");
                    SaveToDisk(config);
                }
            }
            if (config == null)
            {
                Log.W("Config", "Arquivo corrompido, revertendo para defaults");
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

            // Valida parâmetros CRF+VBV
            if (config.Cq < 0 || config.Cq > 51)
                config.Cq = _defaults.Cq;
            if (config.MaxrateKbps < 1000 || config.MaxrateKbps > 500_000)
                config.MaxrateKbps = _defaults.MaxrateKbps;
            if (config.BufsizeKbps < 2000 || config.BufsizeKbps > 1_000_000)
                config.BufsizeKbps = _defaults.BufsizeKbps;
            if (config.Bframes < 0 || config.Bframes > 16)
                config.Bframes = _defaults.Bframes;
            if (config.Lookahead < 0 || config.Lookahead > 256)
                config.Lookahead = _defaults.Lookahead;
            if (string.IsNullOrWhiteSpace(config.EncoderPreset))
                config.EncoderPreset = _defaults.EncoderPreset;

            if (config.MicVolume < 0f || config.MicVolume > 2f)
                config.MicVolume = _defaults.MicVolume;

            config.PttMode = config.PttMode?.ToLowerInvariant() switch
            {
                "hold" => "Hold",
                "toggle" => "Toggle",
                "off" => "Off",
                _ => _defaults.PttMode,
            };

            // Valida diretório de saída (anti-path-traversal)
            if (!string.IsNullOrEmpty(config.OutputDirectory))
            {
                try
                {
                    var resolved = Path.GetFullPath(config.OutputDirectory);
                    var profileDir = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                    if (!resolved.StartsWith(profileDir, StringComparison.OrdinalIgnoreCase))
                    {
                        Log.W("Config", $"OutputDirectory '{resolved}' fora do perfil do usuário — rejeitado");
                        config.OutputDirectory = "";
                    }
                    else
                    {
                        config.OutputDirectory = resolved;
                        if (!Directory.Exists(config.OutputDirectory))
                            Directory.CreateDirectory(config.OutputDirectory);
                    }
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
            Log.E("Config", $"Erro ao carregar: {ex.Message}, revertendo para defaults");
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
            Log.E("Config", $"Erro ao salvar: {ex.Message}");
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

    private static AppConfig CloneConfig(AppConfig source)
    {
        return JsonSerializer.Deserialize<AppConfig>(
            JsonSerializer.Serialize(source)) ?? new AppConfig();
    }

    public void Dispose()
    {
    }
}

/// <summary>
/// Custom JSON converter para Dictionary&lt;int, string&gt; que também aceita arrays number[] (do Electron).
/// Electron envia selectedAudioSessions como [1234, 5678] em vez de {"1234": "FiveM.exe", ...}.
/// </summary>
internal sealed class IntStringDictionaryConverter : JsonConverter<Dictionary<int, string>>
{
    public override Dictionary<int, string> Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
            return new Dictionary<int, string>();

        if (reader.TokenType == JsonTokenType.StartArray)
        {
            var result = new Dictionary<int, string>();
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndArray)
                    return result;

                if (reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var pid))
                {
                    // Use PID como chave, nome fica vazio — será populado via setAudioSessions IPC
                    result[pid] = $"PID:{pid}";
                }
            }
            return result;
        }

        if (reader.TokenType == JsonTokenType.StartObject)
        {
            var result = new Dictionary<int, string>();
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndObject)
                    return result;

                if (reader.TokenType == JsonTokenType.PropertyName)
                {
                    var keyStr = reader.GetString();
                    reader.Read();
                    var value = reader.GetString() ?? string.Empty;
                    if (int.TryParse(keyStr, out var key))
                        result[key] = value;
                }
            }
            return result;
        }

        return new Dictionary<int, string>();
    }

    public override void Write(Utf8JsonWriter writer, Dictionary<int, string> value, JsonSerializerOptions options)
    {
        JsonSerializer.Serialize(writer, value, options);
    }
}
