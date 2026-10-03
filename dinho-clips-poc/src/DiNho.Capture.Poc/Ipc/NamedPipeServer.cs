using System.Collections.Concurrent;
using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.IO.Pipes;
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

    // 5.7: request-id opcional correlaciona respostas assíncronas (commandResult)
    // ao pedido original — o cliente envia e o engine ecoa na resposta.
    [JsonPropertyName("reqId")]
    public string? RequestId { get; set; }

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

    /// <summary>
    /// Alvo da captura ativa: "game" | "window" | "desktop" ("" = inativa). O front
    /// usa isto para mostrar o que está sendo gravado quando não há jogo detectado
    /// (Game = null e' correto semanticamente, mas nao informa o alvo).
    /// </summary>
    [JsonPropertyName("captureMode")]
    public string CaptureMode { get; set; } = "";

    [JsonPropertyName("encoder")]
    public string Encoder { get; set; } = "NONE";

    /// <summary>
    /// Codec de ffmpeg em uso. O renderer precisa dele para re-encodar o clipe no editor
    /// (trim/merge) com a mesma família de hardware em vez de fixar libx264.
    /// </summary>
    [JsonPropertyName("codec")]
    public string Codec { get; set; } = "";

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

    [JsonPropertyName("micLevel")]
    public float MicLevel { get; set; } = 0;

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

    [JsonPropertyName("droppedFrames")]
    public long DroppedFrames { get; set; } = 0;

    [JsonPropertyName("gpuBusyDrops")]
    public long GpuBusyDrops { get; set; } = 0;

    [JsonPropertyName("calibrationTier")]
    public string CalibrationTier { get; set; } = "";
}

public sealed class NamedPipeServer : IDisposable
{
    private const string DefaultPipeName = "dinho-clips-engine";
    private readonly string _pipeName;
    private CancellationTokenSource? _cts;
    private Task? _listenerTask;

    // 5.7 assumia "CurrentUserOnly garante uma única instância Electron" e por isso
    // aceitava filas GLOBAIS drenadas por qualquer cliente que fizesse poll. Esse
    // pressuposto deixou de ser verdade: o accept loop aceita vários clientes (ver ListenLoop)
    // e as filas passaram a ser por-cliente. Ver _clients e _responseRouter.
    private readonly ConcurrentDictionary<Guid, PipeClientChannel> _clients = new();
    private const int MaxBroadcastQueueSize = 1000;

    // 5.8: client tasks registradas p/ Stop() aguardar o drain dos handlers ativos
    // (antes só esperava o listener). Chave = Task.Id; limpa via ContinueWith.
    private readonly ConcurrentDictionary<long, Task> _clientTasks = new();

    public Func<IpcMessage, Task<IpcMessage?>>? OnMessage { get; set; }
    public Func<EngineStatusMessage>? GetStatus { get; set; }

    private Timer? _statusTimer;
    public event Action<EngineStatusMessage>? OnStatusBroadcast;

    public NamedPipeServer(string? pipeName = null)
    {
        _pipeName = pipeName ?? DefaultPipeName;
    }

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

        Log.I("NamedPipeServer", $"Pipe: \\\\.\\pipe\\{_pipeName} (protocolo envelope v1)");
        Log.I("NamedPipeServer", $"Envelope: {{ \"v\": 1, \"cmd\": \"...\", \"payload\": {{...}} }}");

    }

    public void Stop()
    {
        _statusTimer?.Dispose();
        _cts?.Cancel();
        _listenerTask?.Wait(2000);
        _listenerTask = null;

        // 5.8: aguarda (com teto) os handlers de clientes ainda vivos para o
        // drain das filas deles não se perder; útil no shutdown da engine.
        var clients = _clientTasks.Values.ToArray();
        if (clients.Length > 0)
        {
            try { Task.WaitAll(clients, TimeSpan.FromSeconds(2)); }
            catch (AggregateException) { /* handler falhou durante shutdown — ok */ }
            _clientTasks.Clear();
        }
    }

internal ClientResponseRouter ResponseRouter => _responseRouter;

    /// <summary>Clientes já registados (isto é, já em <c>HandleClientAsync</c>). Um
    /// pipe pode estar ligado no SO e ainda não estar aqui: nesse intervalo um
    /// broadcast é perdido. Só usado por testes/diagnóstico.</summary>
    internal int ConnectedClientCount => _clients.Count;

    /// <summary>Regista um cliente sem pipe real. Usado só pelos testes para exercitar
    /// o fan-out de <see cref="BroadcastRaw"/> sem abrir um pipe.</summary>
    internal PipeClientChannel RegisterTestClient()
    {
        var channel = new PipeClientChannel();
        _clients[channel.Id] = channel;
        return channel;
    }

    public void BroadcastRaw(string json)
    {
        // Fan-out: um raw broadcast é por definição para todos os clientes ligados.
        foreach (var client in _clients.Values)
            EnqueueBounded(client.Raw, json, MaxBroadcastQueueSize);
    }

    /// <summary>Enfileira com teto (drop-oldest): impede crescimento ilimitado quando o
    /// consumidor é lento (mesmo padrão do BroadcastRaw). Puro para teste.</summary>
    internal static void EnqueueBounded(ConcurrentQueue<string> queue, string item, int maxSize)
    {
        queue.Enqueue(item);
        while (queue.Count > maxSize)
            queue.TryDequeue(out _);
    }

    private async Task ListenLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            NamedPipeServerStream? server = null;
            bool slotTaken = false;
            try
            {
                // Espera por um slot LIVRE antes de criar a instância: garante que nunca
                // existem mais instâncias do que a capacidade, logo nunca há "pipe busy".
                await _clientSlots.WaitAsync(ct);
                slotTaken = true;

                server = new NamedPipeServerStream(
                    _pipeName,
                    PipeDirection.InOut,
                    maxNumberOfServerInstances: MaxConcurrentClients,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

                await server.WaitForConnectionAsync(ct);

                var captured = server;
                server = null;
                var clientTask = Task.Run(() => HandleClientAsync(captured, slotTaken, ct), ct);
                // 5.8: acompanha o handler até terminar para o Stop() poder aguardá-lo.
                _clientTasks.TryAdd(clientTask.Id, clientTask);
                _ = clientTask.ContinueWith(t => _clientTasks.TryRemove(clientTask.Id, out _),
                    TaskContinuationOptions.ExecuteSynchronously);
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

    private static readonly HashSet<string> _longRunningCommands = new(StringComparer.OrdinalIgnoreCase)
    {
        "saveClip", "trimClip", "mergeClips"
    };

    /// <summary>Tetos de capacidade. O de raw broadcast é por cliente (cada um tem a sua
    /// fila); o de respostas long-running é por cliente E para a fila órfã.</summary>
    private const int MaxClientResponseQueueSize = 32;

    /// <summary>Respostas long-running cujo <c>reqId</c> não pertence a nenhum cliente ligado
    /// (clientes legacy que não enviam reqId — o Electron não envia). Preserva o
    /// comportamento anterior: fila partilhada, drenada por quem pollar primeiro.</summary>
    private readonly ConcurrentQueue<string> _orphanResults = new();

    private readonly ClientResponseRouter _responseRouter = new();

/// <summary>
    /// Teto de clientes em simultâneo. Tem de ser um número POSITIVO e explícito:
    /// <c>NamedPipeServerStream.MaxAllowedServerInstances</c> é -1 (um sentinel), e
    /// <c>new SemaphoreSlim(-1, -1)</c> lança <c>ArgumentOutOfRangeException</c>.
    /// </summary>
    public const int MaxConcurrentClients = 16;

    /// <summary>
    /// Antes de criar uma instância, espera por um slot. Sem isto, criar a 2.ª instância
    /// enquanto a 1.ª está ocupada por um cliente persistente lança <c>IOException</c>
    /// (pipe busy), que era engolida por <c>DebugWrite</c> e gerava um retry por segundo
    /// para sempre — nenhum segundo cliente conseguia jamais ligar-se.
    /// </summary>
    private readonly SemaphoreSlim _clientSlots = new(MaxConcurrentClients, MaxConcurrentClients);

    private void PublishLongRunningResult(string? requestId, string json)
    {
        if (_responseRouter.TryResolve(requestId, out var clientId)
            && _clients.TryGetValue(clientId, out var channel))
        {
            EnqueueBounded(channel.Responses, json, MaxClientResponseQueueSize);
            return;
        }

        EnqueueBounded(_orphanResults, json, MaxClientResponseQueueSize);
    }

private async Task HandleClientAsync(NamedPipeServerStream server, bool slotHeld, CancellationToken ct)
    {
        var channel = new PipeClientChannel();
        var broadcastQueue = channel.Raw;
        _clients[channel.Id] = channel;
        var onStatus = new Action<EngineStatusMessage>(msg =>
        {
            try
            {
                // Fila por-cliente SEM cap era vetor real de crescimento de RAM: se o
                // cliente não lê (pipe cheio → WriteLineAsync bloqueado no drain), os
                // broadcasts de 2s acumulavam para sempre. Cap drop-oldest mantém o
                // status efêmero sempre fresco sem consumo ilimitado.
                EnqueueBounded(broadcastQueue, JsonSerializer.Serialize(msg.ToEnvelope()), MaxBroadcastQueueSize);
            }
            catch { }
        });
        OnStatusBroadcast += onStatus;

        try
        {
            using (server)
            using (var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true))
            using (var writer = new StreamWriter(server, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), bufferSize: 4096, leaveOpen: true) { AutoFlush = true })
            {
                while (!ct.IsCancellationRequested && server.IsConnected)
                {
                    try
                    {
                        using var iterationCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                        iterationCts.CancelAfter(500);
                        // NOTE: ReadLineAsync has no built-in max length limit.
                        // If a malicious client sends data without \n, this will
                        // buffer unbounded memory. The 500ms iterationCts timeout
                        // mitigates slowloris-style attacks but not infinite streams.
                        // 5.10: aceitamos essa limitação para IPC local confiável
                        // (�nico processo, pipe CurrentUserOnly), documentado — não
                        // há superfície não-trustada nesta porta.
                        var line = await reader.ReadLineAsync(iterationCts.Token);
                        if (line == null) break;

                        try
                        {
                            var envelope = JsonSerializer.Deserialize<IpcEnvelope>(line);
                            if (envelope != null && envelope.Version != 1)
                            {
                                // 5.9: versão não-suportada vira erro EXPLÍCITO (antes caía
                                // no fallback IpcMessage e a resposta era descartada em silêncio).
                                var verError = new IpcEnvelope
                                {
                                    Version = 1,
                                    Command = envelope.Command,
                                    Payload = JsonSerializer.SerializeToElement(new
                                    {
                                        error = $"unsupported protocol version: {envelope.Version}",
                                        supportedVersion = 1
                                    })
                                };
                                await writer.WriteLineAsync(JsonSerializer.Serialize(verError));
                            }
                            else if (envelope != null)
                            {
                                if (_longRunningCommands.Contains(envelope.Command) && OnMessage != null)
                                {
                                    var accepted = new IpcEnvelope
                                    {
                                        Version = 1,
                                        Command = envelope.Command,
                                        Payload = JsonSerializer.SerializeToElement(new { status = "accepted" })
                                    };
                                    await writer.WriteLineAsync(JsonSerializer.Serialize(accepted));

                                    var msgCopy = IpcMessage.FromEnvelope(envelope);
                                    if (msgCopy != null)
                                    {
                                        var capturedCmd = envelope.Command;
                                        var capturedMsg = msgCopy;
var capturedReqId = envelope.RequestId;
                                        // Liga o reqId a ESTE cliente antes de disparar o
                                        // trabalho: o resultado tem de saber para onde ir.
                                        _responseRouter.Register(capturedReqId, channel.Id);
                                        _ = ProcessLongRunningAsync(capturedCmd, capturedMsg, capturedReqId, ct);
                                    }
                                }
                                else
                                {
                                    var msg = IpcMessage.FromEnvelope(envelope);
                                    string? responseJson = null;
                                    if (msg != null && OnMessage != null)
                                    {
                                        var resp = await OnMessage(msg);
                                        if (resp != null)
                                        {
                                            var env = resp.ToEnvelope();
                                            env.Command = envelope.Command;
                                            env.RequestId = envelope.RequestId; // 5.7: ecoa o reqId ao cliente
                                            responseJson = JsonSerializer.Serialize(env);
                                        }
                                    }
                                    if (responseJson != null)
                                    {
                                        await writer.WriteLineAsync(responseJson);
                                    }
                                }
                            }
                            else
                            {
                                var msg = JsonSerializer.Deserialize<IpcMessage>(line);
                                string? responseJson = null;
                                if (msg != null && OnMessage != null)
                                {
                                    var resp = await OnMessage(msg);
                                    if (resp != null)
                                        responseJson = JsonSerializer.Serialize(resp.ToEnvelope());
                                }
                                if (responseJson != null)
                                {
                                    await writer.WriteLineAsync(responseJson);
                                }
                            }
                        }
                        catch (JsonException ex)
                        {
                            DebugWrite($"Invalid JSON: {ex.Message}");
                            var errorJson = JsonSerializer.Serialize(new IpcEnvelope
                            {
                                Version = 1,
                                Command = "error",
                                Payload = JsonSerializer.SerializeToElement(new { error = "Invalid JSON" })
                            });
                            await writer.WriteLineAsync(errorJson);
                        }
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        // Poll timeout — no data, continue to drain queues
                    }

                    while (broadcastQueue.TryDequeue(out var broadcastJson))
                    {
                        await writer.WriteLineAsync(broadcastJson);
                    }

while (broadcastQueue.TryDequeue(out var rawJson))
                    {
                        await writer.WriteLineAsync(rawJson);
                    }

                    // Respostas long-running DESTE cliente (por reqId) + a fila órfã
                    // partilhada, para clientes que não enviam reqId.
                    while (channel.Responses.TryDequeue(out var ownResult))
                    {
                        await writer.WriteLineAsync(ownResult);
                    }

                    while (_orphanResults.TryDequeue(out var orphanJson))
                    {
                        await writer.WriteLineAsync(orphanJson);
                    }
                }
            }
        }
        catch (IOException ex)
        {
            Log.E("NamedPipeServer", $"Pipe IO error: {ex.Message}");
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            DebugWrite($"Client handler error: {ex.Message}");
        }
finally
        {
            OnStatusBroadcast -= onStatus;
            _clients.TryRemove(channel.Id, out _);
            _responseRouter.ForgetClient(channel.Id);
            // Liberta o slot para o accept loop poder criar a próxima instância. Sem
            // isto, um cliente que se desconecta deixa o loop à espera para sempre.
            if (slotHeld)
            {
                try { _clientSlots.Release(); }
                catch (SemaphoreFullException) { /* já liberado — nada a fazer */ }
            }
        }
    }

    private async Task ProcessLongRunningAsync(string originalCmd, IpcMessage msg, string? requestId, CancellationToken ct)
    {
        try
        {
            var resp = await OnMessage!(msg);
            IpcEnvelope resultEnvelope;
            if (resp != null)
            {
                resultEnvelope = new IpcEnvelope
                {
                    Version = 1,
                    Command = "_event",
                    Payload = JsonSerializer.SerializeToElement(new
                    {
                        type = "commandResult",
                        originalCmd,
                        requestId, // 5.7: correlaciona o resultado assíncrono ao pedido
                        value = resp.Value
                    })
                };
            }
            else
            {
                resultEnvelope = new IpcEnvelope
                {
                    Version = 1,
                    Command = "_event",
                    Payload = JsonSerializer.SerializeToElement(new
                    {
                        type = "commandResult",
                        originalCmd,
                        requestId,
                        value = new { }
                    })
                };
            }
            PublishLongRunningResult(requestId, JsonSerializer.Serialize(resultEnvelope));
        }
        catch (Exception ex)
        {
            Log.E("NamedPipeServer", $"Long-running command '{originalCmd}' failed: {ex.Message}");
            var errorEnvelope = new IpcEnvelope
            {
                Version = 1,
                Command = "_event",
                Payload = JsonSerializer.SerializeToElement(new
                {
                    type = "commandResult",
                    originalCmd,
                    requestId,
                    error = ex.Message
                })
            };
            PublishLongRunningResult(requestId, JsonSerializer.Serialize(errorEnvelope));
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


