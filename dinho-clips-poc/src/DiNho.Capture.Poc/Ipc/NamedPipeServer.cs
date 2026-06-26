using System.Collections.Concurrent;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.IO.Pipes;
using DiNho.Capture.Poc.Logging;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DiNho.Capture.Poc.Ipc;

public sealed class IpcEnvelope
{
    [JsonPropertyName("v")]
    public int Version { get; set; } = 1;

    [JsonPropertyName("cmd")]
    public string Command { get; set; } = "";

    [JsonPropertyName("payload")]
    public JsonElement? Payload { get; set; }
}

public sealed class IpcMessage
{
    [JsonPropertyName("action")]
    public string Action { get; set; } = "";

    [JsonPropertyName("version")]
    public string Version { get; set; } = "1.0";

    [JsonPropertyName("value")]
    public JsonElement? Value { get; set; }

    public IpcEnvelope ToEnvelope()
    {
        return new IpcEnvelope
        {
            Version = 1,
            Command = Action,
            Payload = Value
        };
    }

    public static IpcMessage? FromEnvelope(IpcEnvelope env)
    {
        if (env.Version != 1) return null;
        return new IpcMessage
        {
            Action = env.Command,
            Value = env.Payload
        };
    }
}

public sealed class EngineStatusMessage
{
    [JsonPropertyName("event")]
    public string Event { get; set; } = "engineStatus";

    [JsonPropertyName("version")]
    public string Version { get; set; } = "1.0";

    [JsonPropertyName("value")]
    public EngineStatusValue Value { get; set; } = new();

    public IpcEnvelope ToEnvelope()
    {
        return new IpcEnvelope
        {
            Version = 1,
            Command = "_event",
            Payload = JsonSerializer.SerializeToElement(new
            {
                type = Event,
                data = Value
            })
        };
    }
}

public sealed class EngineStatusValue
{
    [JsonPropertyName("captureBackend")]
    public string CaptureBackend { get; set; } = "DXGI";

    [JsonPropertyName("encoder")]
    public string Encoder { get; set; } = "NONE";

    [JsonPropertyName("diskSpaceOk")]
    public bool DiskSpaceOk { get; set; } = true;

    [JsonPropertyName("lastCrashRecovered")]
    public bool LastCrashRecovered { get; set; } = false;

    [JsonPropertyName("game")]
    public string? Game { get; set; } = null;

    [JsonPropertyName("recording")]
    public bool Recording { get; set; } = false;

    [JsonPropertyName("uptimeSeconds")]
    public long UptimeSeconds { get; set; } = 0;

    [JsonPropertyName("audioFallback")]
    public bool AudioFallback { get; set; } = false;

    [JsonPropertyName("lastFrameMs")]
    public double LastFrameMs { get; set; } = 0;

    [JsonPropertyName("lastClipSize")]
    public long LastClipSize { get; set; } = 0;

    [JsonPropertyName("activePipelines")]
    public int ActivePipelines { get; set; } = 0;

    [JsonPropertyName("watchdogOk")]
    public bool WatchdogOk { get; set; } = true;

    [JsonPropertyName("memoryMB")]
    public int MemoryMB { get; set; } = 0;

    [JsonPropertyName("replayBufferBytes")]
    public long ReplayBufferBytes { get; set; } = 0;

    [JsonPropertyName("replayBufferVideoFrames")]
    public int ReplayBufferVideoFrames { get; set; } = 0;

    [JsonPropertyName("replayBufferVideoBytes")]
    public long ReplayBufferVideoBytes { get; set; } = 0;

    [JsonPropertyName("replayBufferAudioPackets")]
    public int ReplayBufferAudioPackets { get; set; } = 0;

    [JsonPropertyName("replayBufferAudioBytes")]
    public long ReplayBufferAudioBytes { get; set; } = 0;

    [JsonPropertyName("outputDirectory")]
    public string OutputDirectory { get; set; } = "";
}

public sealed class NamedPipeServer : IDisposable
{
    private const string PipeName = "dinho-clips-engine";
    private CancellationTokenSource? _cts;
    private Task? _listenerTask;

    public Func<IpcMessage, Task<IpcMessage?>>? OnMessage { get; set; }
    public Func<EngineStatusMessage>? GetStatus { get; set; }

    private Timer? _statusTimer;
    public event Action<EngineStatusMessage>? OnStatusBroadcast;

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _listenerTask = Task.Run(() => ListenLoop(_cts.Token));

        _statusTimer = new Timer(_ =>
        {
            if (GetStatus != null)
            {
                var status = GetStatus();
                OnStatusBroadcast?.Invoke(status);
            }
        }, null, 2000, 2000);

        Console.WriteLine($"[NamedPipeServer] Pipe: \\\\.\\pipe\\{PipeName} (protocolo envelope v1)");
        Console.WriteLine($"[NamedPipeServer) Envelope: {{ \"v\": 1, \"cmd\": \"...\", \"payload\": {{...}} }}");

    }

    public void Stop()
    {
        _statusTimer?.Dispose();
        _cts?.Cancel();
        _listenerTask?.Wait(2000);
        _listenerTask = null;
    }

    private async Task ListenLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            NamedPipeServerStream? server = null;
            try
            {
                server = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    maxNumberOfServerInstances: 1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                await server.WaitForConnectionAsync(ct);

                var captured = server;
                server = null; // ownership transferred to handler
                _ = Task.Run(() => HandleClientAsync(captured, ct), ct);
            }
            catch (OperationCanceledException)
            {
                server?.Dispose();
                break;
            }
            catch (Exception ex)
            {
                server?.Dispose();
                DebugWrite($"Pipe server error: {ex.Message}");
                Thread.Sleep(1000);
            }
        }
    }

    private async Task HandleClientAsync(NamedPipeServerStream server, CancellationToken ct)
    {
        var broadcastQueue = new ConcurrentQueue<string>();

        Action<EngineStatusMessage>? onStatus = null;
        onStatus = msg =>
        {
            try
            {
                broadcastQueue.Enqueue(JsonSerializer.Serialize(msg.ToEnvelope()));
            }
            catch { /* serialization error — skip this broadcast */ }
        };
        OnStatusBroadcast += onStatus;

        try
        {
            using (server)
            using (var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true))
            using (var writer = new StreamWriter(server, Encoding.UTF8, bufferSize: 4096, leaveOpen: true) { AutoFlush = true })
            {
                while (!ct.IsCancellationRequested && server.IsConnected)
                {
                    // Poll: wait up to 500ms for a command from Electron
                    var readTask = reader.ReadLineAsync(ct).AsTask();
                    var pollTask = Task.Delay(500, ct);
                    var completed = await Task.WhenAny(readTask, pollTask);

                    if (completed == readTask)
                    {
                        var line = await readTask;
                        if (line == null) break;

                        string? responseJson = null;
                        try
                        {
                            var envelope = JsonSerializer.Deserialize<IpcEnvelope>(line);
                            if (envelope != null)
                            {
                                var msg = IpcMessage.FromEnvelope(envelope);
                                if (msg != null && OnMessage != null)
                                {
                                    var resp = await OnMessage(msg);
                                    if (resp != null)
                                    {
                                        // Echo back original cmd for Electron response matching
                                        var env = resp.ToEnvelope();
                                        env.Command = envelope.Command;
                                        responseJson = JsonSerializer.Serialize(env);
                                    }
                                }
                            }
                            else
                            {
                                // Fallback: tenta parser como mensagem legacy (sem envelope)
                                var msg = JsonSerializer.Deserialize<IpcMessage>(line);
                                if (msg != null && OnMessage != null)
                                {
                                    var resp = await OnMessage(msg);
                                    if (resp != null)
                                        responseJson = JsonSerializer.Serialize(resp.ToEnvelope());
                                }
                            }
                        }
                        catch (JsonException ex)
                        {
                            DebugWrite($"Invalid JSON: {ex.Message}");
                            responseJson = JsonSerializer.Serialize(new IpcEnvelope
                            {
                                Version = 1,
                                Command = "error",
                                Payload = JsonSerializer.SerializeToElement(new { error = "Invalid JSON" })
                            });
                        }

                        if (responseJson != null)
                        {
                            await writer.WriteLineAsync(responseJson);
                        }
                    }
                    else if (readTask.IsFaulted)
                    {
                        break;
                    }
                    // else: poll timeout — drain broadcasts below

                    // Write any pending status broadcasts to the pipe
                    while (broadcastQueue.TryDequeue(out var broadcastJson))
                    {
                        await writer.WriteLineAsync(broadcastJson);
                    }
                }
            }
        }
        catch (IOException)
        {
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            DebugWrite($"Client handler error: {ex.Message}");
        }
        finally
        {
            OnStatusBroadcast -= onStatus;
        }
    }

    [Conditional("DEBUG")]
    private static void DebugWrite(string msg)
    {
        System.Diagnostics.Debug.WriteLine($"[NamedPipeServer] {msg}");
    }

    public void Dispose()
    {
        Stop();
    }
}
