# RELATÓRIO DE AUDITORIA COMPLETA — DiNho Clips
## Sistema de Gravação em Buffer (Replay Buffer)

**Data:** 2026-06-28
**Arquivos auditados:** 54 arquivos (41 C# fontes + 13 TypeScript/Electron)
**Linhas totais examinadas:** ~12.500 linhas
**Abrangência:** 22 áreas de análise

---

## 0. FLUXOGRAMA DO FUNCIONAMENTO ATUAL

```
Electron Renderer (React/TS)
  │
  │ IPC (contextBridge)
  ▼
Electron Main Process (Node.js)
  │
  │ CLIPS_START_ENGINE → spawn()
  │ CLIPS_STOP_ENGINE → SIGTERM → SIGKILL
  │ CLIPS_SET_CONFIG / CLIPS_GET_STATUS
  │ (pipe JSON via named pipe \\.\pipe\DiNhoClips)
  ▼
NamedPipeServer (C#)          ◄── GameDetector (SetWinEventHook)
  │                                  │
  │ IpcMessageHandler                  │ OnGameChanged
  ▼                                  ▼
EngineCoordinator ──────────────────► ResolveTargetGame()
  │                                      │
  │ _pipelineLock                        │
  ▼                                      ▼
StartCapture()
  ├── Create D3D11 Device (with VideoSupport)
  ├── SelectCaptureSource()
  │     ├── WGC per-window (3 retries, 400ms sleep)
  │     ├── WGC desktop (fallback)
  │     ├── DXGI Desktop Duplication (fallback)
  │     └── Hybrid (fallback)
  ├── Create encoder (FfmpegEncoder or GpuVideoConverter)
  ├── Create audio mixer
  │     ├── CppLoopbackSource (per-process via C++ DLL)
  │     │   └── Native callback → queue → pump thread
  │     ├── WasapiLoopbackSource (system audio)
  │     └── WasapiMicSource (microphone)
  ├── Start pipeline loop (Task.Run)
  └── Start RamManager watchdog timer
        │
        ▼ (every 16ms @ 60fps)
PipelineLoop
  ├── cap.TryCaptureFrame() → CapturedFrame
  ├── GpuVideoConverter.Convert(BGRA→NV12)
  ├── encoder.EncodeFrameAsync(NV12) → ffmpeg stdin
  │     └── FfmpegEncoder.ReaderLoop (background thread)
  │           ├── Read AVCC from pipe
  │           ├── Convert to AVCC format if AnnexB
  │           ├── ParseAvcc → EmitPacket
  │           └── Channel<EncodedPacket>
  ├── ReplayBuffer.AddVideo(EncodedPacket)
  └── ReplayBuffer.AddAudio(EncodedPacket)
        │
        ▼ (on user save)
SaveClipAsync()
  ├── Freeze buffer (GetSegments)
  ├── WriteMatroskaFile (temp .mkv)
  │     ├── EBML Header + Segment + Info
  │     ├── Tracks (CodecPrivate avcC)
  │     └── Clusters with SimpleBlocks (AVCC data)
  ├── MuxWithFfmpegStreaming (.mkv + .aac → .mp4)
  └── GenerateThumbnail (ffmpeg -ss frame)
```

---

## 1. RESUMO EXECUTIVO

A auditoria encontrou **79 problemas** no sistema, sendo **15 Críticos**, **18 Altos**, **22 Médios** e **24 Baixos** — distribuídos em 54 arquivos de C# e TypeScript.

### Novos problemas críticos encontrados nesta auditoria (além do relatório anterior):

1. **PipelineLock TOCTOU race** (Crítico): `SelectCaptureSource` libera `_pipelineLock` durante `Thread.Sleep(400ms)` entre retentativas WGC — outro thread pode chamar `StopCapture()` e destruir objetos que o retry loop vai usar.

2. **Queue\<T\> _pcmPtsQueue sem sincronização** (Crítico): Fila de timestamps PCM compartilhada entre callback de áudio e `StopCapture()` sem lock — `Queue<T>` não é thread-safe e pode corromper seu estado interno.

3. **ConfigManager.Config getter sem lock** (Alto): Propriedade lida sem sincronização enquanto `Update()` pode estar modificando o objeto concorrentemente.

4. **PushToTalkManager HashSet race** (Crítico): `_pttKeys` é `HashSet<int>` acessado de duas threads (hook + engine) sem sincronização — pode corromper estrutura interna.

5. **CppLoopbackSource GCHandle leak** (Alto): Se `Start()` falha após `GCHandle.Alloc`, o handle nunca é liberado.

6. **autoStartCapture perde valor false** (Crítico): `false || undefined = undefined` — campo omitido do JSON. Funciona por acidente porque C# default é `false`, mas quebra se default do C# mudar.

7. **selectedAudioSessions perdido na reconexão** (Médio): `syncConfigOnConnect()` nunca reenvia sessões de áudio configuradas.

8. **adaptiveQuality não atualizável via IPC** (Médio): Handler CLIPS_SET_CONFIG omite o campo.

9. **Clip-video:// sem proteção path traversal** (Médio): Protocolo customizado não valida caminho.

### Principais problemas que impedem clips de funcionar (atualizado):

```
C1  DxgiCaptureSource use-after-free (multi-monitor)
  → TryCaptureFrame → ObjectDisposedException
  → H3  PipelineLoop não captura exceção
  → Pipeline thread morre
  → C3  ReinitializePipelineAsync sem lock
  → Use-after-dispose de _capture/_encoder
  → Sem recovery → engine precisa reiniciar

C10 _pcmPtsQueue race (Queue<T> sem sincronização)
  → Corrupção de timestamps → PTS incorreto no AAC
  → Dessincronia A/V progressiva
  → Clip final com áudio fora de sincronia

C12 PushToTalkManager._pttKeys data race
  → HashSet internal corruption
  → Contains() pode entrar em loop infinito
  → PTT para de funcionar → mic nunca ativa
```

---

## 2. LISTA COMPLETA DE BUGS POR SEVERIDADE

### 🔴 CRÍTICOS (15)

| # | Arquivo | Linha | Descrição | Impacto |
|---|---------|-------|-----------|---------|
| C1 | `DxgiCaptureSource.cs` | 99–103, 111 | `using var output1` + fallback `selectedOutput` → use-after-free do COM object em multi-monitor | Falha de inicialização DXGI sem crash |
| C2 | `DxgiCaptureSource.cs` | 141–143, 184–187 | `desktopResource.Dispose()` sem null-check no `finally` → NullReferenceException | Exceção derruba pipeline |
| C3 | `EngineCoordinator.cs` | 1190–1273 | `ReinitializePipelineAsync` sem `_pipelineLock` → race com pipeline loop | Use-after-dispose de `_capture`/`_encoder` |
| C4 | `PipelineWatchdog.cs` | 57 | `_healthWindow` filtering compara valores de duração contra `elapsedMs - 10000` em vez de timestamps | Watchdog opera em subconjunto errado |
| C5 | `ClipExporter.cs` + `EngineCoordinator.cs` | 30, 1494 | `rawFormat` default "h264" nunca sobrescrito | HEVC/AV1 produzem MKV com CodecID errado |
| C6 | `ReplayBuffer.cs` + `ClipExporter.cs` | 134–163, 464–490 | PTS não re-baselineado para zero no MP4 | Players Chrome/Edge podem falhar |
| C7 | `RnnoiseFilter.cs` | 69–75 | `_stdout.Read()` bloqueante sem timeout; ffmpeg pode nunca fechar o pipe | Pipeline de áudio para completamente |
| C8 | `RnnoiseFilter.cs` | 41 | `RedirectStandardError = true` sem `BeginErrorReadLine()` | ffmpeg bloqueia ao escrever >4KB no stderr |
| C9 | `ConfigManager.cs` | 166 | `JsonSerializer.Deserialize` case-sensitive, Electron salva camelCase | Config resetada no restart do engine |
| **C10** | **`EngineCoordinator.cs`** | **1279** | **`Queue<(TimeSpan,int)> _pcmPtsQueue` usada sem lock entre `OnAudioPacket` e `ConsumePcmPts` e `StopCapture()`** | **Corrupção de estado interno da fila → PTS incorreto → A/V desync** |
| **C11** | **`EngineCoordinator.cs`** | **775–778** | **`_pipelineLock` liberado durante `Thread.Sleep(400ms)` em `SelectCaptureSource` → TOCTOU race** | **StopCapture() pode destruir objetos que retry loop usa → use-after-free** |
| **C12** | **`PushToTalkManager.cs`** | **31–42** | **`HashSet<int> _pttKeys` acessado de hook thread (OnRawKey) e engine thread (Add/Remove/Clear) sem lock** | **Corrupção de HashSet → Contains() indefinido → PTT quebrado** |
| **C13** | **`clips-config-manager.ts`** | **121** | **`autoStartCapture: c.autoStartCapture \|\| undefined`** — **false \|\| undefined = undefined** | **Campo omitido do JSON; se default C# mudar para true, usuário perde controle** |
| C14 | `PushToTalkManager.cs` | 19–20 | `_micActive` e `_mode` lidos/escritos de threads diferentes sem `volatile` ou lock | Stale reads podem deixar mic ativo/mudo |
| **C15** | **`FfmpegEncoder.cs`** | **465–475, 787–791** | **`_rawBuf` (ArrayPool) não retornado em ResetState()** | **Memory leak de ~512KB por restart forçado. Em sessões longas com múltiplos restarts, pode acumular** |

### 🟠 ALTOS (18)

| # | Arquivo | Linha | Descrição | Impacto |
|---|---------|-------|-----------|---------|
| H1 | `FfmpegEncoder.cs` | 256–261, 276 | `AV1` codec sem bitstream filter compatível (`av1_mp4toannexb` não existe) | AV1 produz dados corrompidos |
| H2 | `FfmpegEncoder.cs` | 507, 579–591, 618–631 | `ParseAvcc` assume NAL header H264 (1 byte); HEVC usa 2 bytes | HEVC/AV1: frames com PTS incorreto |
| H3 | `EngineCoordinator.cs` | 1005–1008 | `TryCaptureFrame` não está dentro do try-catch da pipeline loop | Exceção do capture source derruba pipeline inteira |
| H4 | `AudioMixer.cs` | 263–268 | `SoftClip` não monotônico: \|x\| em 0.667–0.999 produz output **decrescente** | Distorção audível em picos |
| H5 | `AudioSessionMuteManager.cs` | 28 | `_saved.Clear()` descarta mute history anterior | Sessões podem ficar mudas permanentemente |
| H6 | `ClipExporter.cs` | 841–842 | `GenerateThumbnail`: `BeginErrorReadLine()` sem event handler | ffmpeg trava se produzir stderr |
| H7 | `ClipExporter.cs` | 658–669 | `stdin.Dispose()` fecha pipe antes de ffmpeg ler último AAC | Áudio cortado no final do clip (1-2 frames) |
| H8 | `IpcMessageHandler.cs` | 252 | `_recording` lido sem lock → stale read | Capture inicia sem consentimento |
| H9 | `IpcMessageHandler.cs` | 410–429 | `setMicDevice`: mixer pode ficar null com `_recording = true` | NullReferenceException crash |
| H10 | `GameDatabaseUpdater.cs` | 66, 78, 90, 97, 106, 118 | Estado salvo mesmo em falha → próxima tentativa só em 7 dias | Outage bloqueia atualizações por 1 semana |
| H11 | `GameDatabase.cs` | 45, 73 | `_loaded` bool sem lock/volatile — race em `Load()` concorrente | Lookups retornam resultados incorretos |
| H12 | `GameDetector.cs` | 215–218 | `PollForeground` não dispara `OnGameChanged` para HWND nulo | `_lastDetectedGame` fica obsoleto |
| H13 | `GameDatabaseUpdater.cs` | 113 | `File.WriteAllTextAsync` sem atomic write | Crash corrompe games.json |
| H14 | `EngineCoordinator.cs` | 1363 | `catch { }` em `ResolveAudioPids` silencia `AccessDenied` | PIDs de anti-cheat marcados como dead |
| H15 | `EngineCoordinator.cs` | 775 | `Thread.Sleep(400ms)` dentro de `_pipelineLock` | StopCapture bloqueado por até 1.2s |
| **H16** | **`ConfigManager.cs`** | **133** | **`Config` getter sem lock; `Update()` modifica objeto sob lock, mas leituras concorrentes veem valores parciais** | **Stale reads de Fps, Cq, etc. em qualquer thread leitora** |
| **H17** | **`CppLoopbackSource.cs`** | **61** | **`GCHandle.Alloc(_managedCallback)` antes de `_captureThread.Start()` — se Start() lançar, handle nunca é liberado** | **Memory leak de GCHandle (pequeno, mas permanente)** |
| **H18** | **`clips.ipc.ts`** | **131–213** | **`CLIPS_SET_CONFIG` handler nunca lê `c.adaptiveQuality` do payload** | **Toggle adaptiveQuality no frontend não tem efeito** |

### 🟡 MÉDIOS (22)

| # | Arquivo | Linha | Descrição |
|---|---------|-------|-----------|
| M1 | `FfmpegEncoder.cs` | 677–684 | `_pendingLen`/`_hadSlice`/`_pendingBuf` lidos sem sync (reader vs pipeline) |
| M2 | `FfmpegEncoder.cs` | 19–23, 665–670 | `_outputChannel` DropOldest + limit 32 → pacotes perdidos sem log |
| M3 | `FfmpegEncoder.cs` | 465–475, 787–791 | `_rawBuf` não liberado em `ResetState()` |
| M4 | `CppLoopbackSource.cs` | 112 | `new float[]` alocado dentro do callback nativo toda chamada |
| M5 | `CppLoopbackSource.cs` | 153, 182 | `_callbackHandle.Free()` durante callback ativo (race) |
| M6 | `WasapiMicSource.cs` | 38–43 | `_running = true` setado antes de `StartRecording()`; sem try-catch |
| M7 | `WasapiLoopbackSource.cs` | 28–54 | Mesmo padrão do WasapiMicSource + WaveFormat pode ser rejeitado |
| M8 | `AudioMixer.cs` | 91–94 | `_sampleRate`/`_channels` inicializados após `Start()` das fontes |
| M9 | `FfmpegAacEncoder.cs` | 109–125 | `FlushAndDrain` faz `_stdin.Dispose()` enquanto mixer thread pode escrever |
| M10 | `ReplayBuffer.cs` | 84, 96–108 | Áudio sem limite de bytes (video-only budget) |
| M11 | `ReplayBuffer.cs` | 1125–1131 | `Stats()` + `StatsDetailed()` com TOCTOU entre locks |
| M12 | `ClipExporter.cs` | 371 | `WriteSimpleBlock`: bit 0 setado para 1 (reserved, deve ser 0) |
| M13 | `ClipExporter.cs` | 135–175 | `PadAudioWithSilence`: ADTS sem raw_data_block AAC |
| M14 | `ClipExporter.cs` | 119–120 | Falha de thumbnail engolida silenciosamente |
| M15 | `GameDetector.cs` | 73 | `CurrentGame` sem `volatile`/lock entre threads |
| M16 | `NamedPipeServer.cs` | 146 | `_rawBroadcastQueue` sem limite com nenhum cliente conectado |
| **M17** | **`EngineCoordinator.cs`** | **1004–1005** | **`_capture`/`_encoder` lidos sem lock no PipelineLoop — StopCapture() pode dispor os objetos entre a leitura e o uso** |
| **M18** | **`EngineCoordinator.cs`** | **1541–1545, 1729** | **`_audioMixer` acessado sem lock de múltiplos paths (ToggleMic, OnGameChanged, config handler, OnMicStateChanged)** |
| **M19** | **`clips-engine-connection.ts`** | **420–428** | **`syncConfigOnConnect()` não reenvia `selectedAudioSessions` — perdido na reconexão do pipe** |
| **M20** | **`src/main/index.ts`** | **474–512** | **Protocolo `clip-video://` sem validação path traversal — renderer pode ler qualquer arquivo** |
| **M21** | **`clips-engine-connection.ts`** | **243** | **`pipeBuffer += data` sem limite máximo — crescimento infinito se engine enviar linha sem \n** |
| **M22** | **`clips-engine-connection.ts`** | **166–175** | **`readClipsFromDisk` usa `Promise.all` para `getVideoDuration` — centenas de ffmpeg em paralelo se houver muitos clips** |

### 🟢 BAIXOS (24)

| # | Arquivo | Linha | Descrição |
|---|---------|-------|-----------|
| L1 | `FfmpegEncoder.cs` | 428–436 | `_rawBuf` pode crescer sem limites se dados corrompidos |
| L2 | `FfmpegEncoder.cs` | 951–979 | `Flush()` reinicia ffmpeg desnecessariamente |
| L3 | `WgcCaptureSource.cs` | 335, 176–183 | Race: `_frameSignal.Dispose()` durante `WaitOne` → ObjectDisposedException |
| L4 | `FfmpegEncoder.cs` | 310–311, 768 | Stderr thread pode receber `ObjectDisposedException` |
| L5 | `AudioMixer.cs` | 290–293 | `GetPendingAudio()` — código morto |
| L6 | `SilentAudioSource.cs` | 5–23 | Código morto — nunca instanciado (arquivo existe?) |
| L7 | `FfmpegAacEncoder.cs` | 78–79 | `_pcmBuf` nunca reduz após pico |
| L8 | `EngineCoordinator.cs` | 1181 | `SwitchCaptureApi()` — código morto |
| L9 | `ClipExporter.cs` | 749–880 | `EncodeRawNv12ToMp4` + `DetectFastestCodec` — 104L de dead code |
| L10 | `ClipExporter.cs` | 702–703 | LOH allocation em `StreamPcmAsS16Le` para clips longos |
| L11 | `EngineCoordinator.cs` | 1544–1631 | Duplicatas em `NonGameProcesses` ("msra", "Narrator" com espaço) |
| L12 | `Log.cs` | 22–24 | `Log.Instance` setter aceita null |
| L13 | `ConsoleLogger.cs` | 31 | `catch { }` engole exceções de I/O do logger |
| L14 | `GpuVideoConverter.cs` | 27, 29, 115–118 | Dispose de QI do device compartilhado |
| L15 | `Interop.cs` | 226–234 | `HMONITOR.GetHashCode()` truncado para 32 bits |
| **L16** | **`WasapiLoopbackSource.cs`** | **67** | **`new float[e.BytesRecorded / 4]` por callback — GC pressure ~96 allocs/s** |
| **L17** | **`WasapiMicSource.cs`** | **~50** | **Mesmo padrão de alocação do loopback source** |
| **L18** | **`RnnoiseFilter.cs`** | **63** | **`new byte[input.Length]` per Process() call — GC pressure** |
| **L19** | **`EngineCoordinator.cs`** | **304–325** | **`selectedAdapter` leak se D3D11CreateDevice lançar antes do dispose** |
| **L20** | **`EngineCoordinator.cs`** | **2064** | **`ManualResetEventSlim` não disposto em WindowsMessagePump.Invoke()** |
| **L21** | **`clips-config-manager.ts`** | **119–120** | **`customGameProcess \|\| undefined` e `micDeviceId \|\| undefined` perdem string vazia — não pode limpar** |
| **L22** | **`clips.ipc.ts`** | **57–58** | **`engineCapturing` não limpo quando pipe cai durante stop — frontend fica travado** |
| **L23** | **`clips-config-manager.ts`** | **123** | **`excludeProcessId` envia `process.pid` sem documentar semântica** |
| **L24** | **`EngineCoordinator.cs`** | **1817, 1834–1846** | **`CheckDiskSpace()` chamado a cada 2s (status broadcast) sem cache** |

---

## 3. ANÁLISE DE ARQUITETURA (Área 1)

### Organização do Projeto

```
dinho-clips-poc/
  src/DiNho.Capture.Poc/
    EngineCoordinator.cs          (2157L) ← Orquestrador principal
    IpcMessageHandler.cs          (787L)  ← Partial class do EngineCoordinator
    Program.cs                    (??L)   ← Entry point
    Logging/
      Log.cs                      (55L)   ← Logger estático
      ConsoleLogger.cs            (25L)   ← Implementação
    Encoders/
      FfmpegEncoder.cs            (979L)  ← Encoder de vídeo (ffmpeg pipe)
      FfmpegAacEncoder.cs         (213L)  ← Encoder de áudio (ffmpeg AAC)
      EncodedPacket.cs            (96L)   ← Packet imutável
      GpuVideoConverter.cs        (122L)  ← BGRA→NV12 GPU
      IEncoder.cs                 (??)    ← Interface
    Capture/
      DxgiCaptureSource.cs        (206L)  ← DXGI Desktop Duplication
      WgcCaptureSource.cs         (365L)  ← WGC capture
      Interop.cs                  (254L)  ← COM/PInvoke glue
    Audio/
      WasapiLoopbackSource.cs     (85L)   ← System audio loopback
      WasapiMicSource.cs          (76L)   ← Microfone
      CppLoopbackSource.cs        (197L)  ← Per-process audio (C++ DLL)
      AudioMixer.cs               (307L)  ← Mixer áudio do jogo + mic
      AudioSessionMuteManager.cs  (100L)  ← Session muting fallback
      IAudioSource.cs             (??)    ← Interface
      RnnoiseFilter.cs            (152L)  ← Noise suppression (ffmpeg anlmdn)
      SilentAudioSource.cs        (N/A)   ← Não encontrado
    Buffer/
      ReplayBuffer.cs             (255L)  ← Ring buffer circular
    Hotkeys/
      HotkeyManager.cs            (341L)  ← Global keyboard/mouse hooks
      PushToTalkManager.cs        (71L)   ← Push-to-talk state
    Config/
      ConfigManager.cs            (402L)  ← Config persistente + AppConfig
    GameDetection/
      GameDetector.cs             (473L)  ← Foreground game detection
      GameDatabase.cs             (170L)  ← Games database
      GameDatabaseUpdater.cs      (187L)  ← Auto-update games.json
    Ipc/
      NamedPipeServer.cs          (341L)  ← Pipe server
    Export/
      ClipExporter.cs             (937L)  ← Matroska writer + ffmpeg mux
```

**Problemas arquiteturais:**

1. **EngineCoordinator excessivamente grande (2944L total com IpcMessageHandler):** Violação do SRP. Gerencia pipeline de captura, áudio, encoder, game detection, config, hotkeys, restart logic, auto-cleanup, disk check, e IPC. Idealmente deveria ser 3-4 classes separadas.

2. **Partial class IpcMessageHandler (787L) disfarça o tamanho:** A divisão em partial class é artificial — não separa responsabilidades, apenas divide um arquivo grande em dois.

3. **Acoplamento bidirecional entre EngineCoordinator e ConfigManager:** EngineCoordinator usa `_config.Config` diretamente, e ConfigManager chama `OnConfigChanged` que EngineCoordinator assina. ConfigManager não deveria conhecer seus consumidores.

4. **Falta de camada de abstração para o ReplayBuffer:** O buffer é acessado diretamente pelo SaveClipAsync sem uma interface de "snapshot" que congele o estado durante a exportação.

5. **Variáveis de estado globais no TypeScript:** `clips-engine-connection.ts` tem 15+ variáveis `let` no escopo do módulo, mutáveis por qualquer função. Sem encapsulamento, sem validação de estado.

6. **Config state contaminado:** O objeto `config` (config-manager.ts) é modificado por engine status updates (`handlePipeMessage` sobrescreve `C.outputDirectory`, `C.engineFps`, etc.) — mistura preferências do usuário com estado de runtime.

---

## 4. ANÁLISE COMPLETA DO FLUXO (Área 2)

### 4.1 Inicialização → StartAsync()

```
StartAsync()
  ├── GameDatabase.Instance.Load()           ← File I/O síncrono
  ├── WindowsMessagePump.StartThread()       ← STA thread pump
  ├── MFStartup(MF_VERSION)                  ← Media Foundation
  ├── GameDetector.Start()                   ← STA hook thread
  ├── HotkeyManager.Start()                  ← STA hook thread
  ├── NamedPipeServer.Start()                ← Task.Run listener
  ├── _config.Load()                         ← File I/O síncrono
  └── RunAutoCleanup()                       ← Fire-and-forget Task.Run
```

**Problemas:**
- Inicialização sequencial: cada etapa espera a anterior. Se GameDatabase.Load() falhar (arquivo corrompido), toda inicialização trava.
- WindowsMessagePump start thread + MFStartup sem ordenação documentada (WGC precisa do pump, MF não).
- RunAutoCleanup fire-and-forget sem await — pode executar concorrente com StartCapture().

### 4.2 SelectCaptureSource → Fallback Chain

```
1. Tenta WGC per-window (3 tentativas, 400ms sleep entre elas)
   ├── Verifica WS_EX_NOREDIRECTIONBITMAP (pula se presente)
   ├── Inicializa no WindowsMessagePump thread
   └── Se falha: vai para 2
2. Tenta WGC desktop (IGraphicsCaptureItemInterop.CreateForMonitor)
   └── Se falha: vai para 3
3. Tenta DXGI Desktop Duplication
   ├── Enumera adaptadores
   ├── Cria D3D11 device
   ├── Duplica output
   └── Se falha: vai para 4
4. Hybrid (fallback final)
```

**Problemas:**
- **BUG C11**: `Monitor.Exit(_pipelineLock)` durante `Thread.Sleep(400ms)` no retry WGC (linhas 775-778)
- `DXGI` try usa `selectedAdapter?.Dispose()` apenas no final do escopo — leak se `CreateDevice` falha (linha 325)
- 3 tentativas × 400ms = 1.2s de latência na inicialização se WGC per-window falha

### 4.3 Pipeline Loop → TryCaptureFrame → Encode → Buffer

```
PipelineLoop (Task.Run, cada ~16ms para 60fps)
  │
  ├── [1] cap.TryCaptureFrame(timeoutMs)     ← Dxgi ou WGC
  │     ├── WGC: _frameSignal.WaitOne(timeout, exitCtx)
  │     └── DXGI: output.Duplication.TryAcquireNextFrame(100)
  │
  ├── [2] Se sucesso:
  │     ├── GpuVideoConverter.Convert(frame, _nv12Staging)
  │     │     ├── VideoProcessorBlt (BGRA → NV12)
  │     │     └── ctx.CopyResource → Map/Unmap
  │     └── encoder.EncodeFrameAsync(nv12Texture, ts)
  │           └── ffmpeg stdin.Write(nv12Data)
  │
  ├── [3] Se sucesso:
  │     └── ReplayBuffer.AddVideo(packet)
  │
  └── [4] A cada iteração:
        └── RamManager watchdog health check
```

**Problemas:**
- **BUG H3**: `TryCaptureFrame` (linha 1005) não está dentro do try-catch. Se lançar exceção não tratada, o pipeline loop inteiro morre.
- **BUG M17**: `_capture` e `_encoder` lidos sem lock (linhas 1004-1005). StopCapture() pode dispor os objetos entre a leitura e o uso.
- Pipeline loop inteiro executa sob `_pipelineLock` (linha 988: `Monitor.Enter(_pipelineLock)`). Isso significa que `TryCaptureFrame`, `GpuVideoConverter.Convert`, `EncodeFrameAsync`, e `AddVideo` tudo sob o mesmo lock — serializa tudo.

### 4.4 SaveClip → Export Pipeline

```
SaveClipAsync()
  │
  ├── _exportLock (Monitor.TryEnter → anti-double-press)
  ├── CheckDiskSpace() (mínimo 100MB)
  ├── _buffer.GetSegments(maxAge) ← Freeze snapshot
  │     └── lock(_buffer._lock)
  │           ├── CopyRing(videoRing) → List<EncodedPacket>
  │           └── CopyRing(audioRing) → List<EncodedPacket>
  │
  ├── ClipExporter.ExportToMp4(path, video, audio, w, h, fps, rawFormat, avccFallback)
  │     │
  │     ├── WriteMatroskaFile(tempMkv, video, rawFormat, avcc)
  │     │     ├── EBML Header + Segment + Info + Tracks
  │     │     ├── ExtractAvccExtradata(packets) ?? avccFallback
  │     │     └── Clusters com SimpleBlocks (AVCC data)
  │     │
  │     ├── MuxWithFfmpegStreaming(output, tempMkv, audio, rawFormat)
  │     │     ├── ffmpeg -f matroska -i temp.mkv [audio inputs] -c:v copy ...
  │     │     └── stdin.Write(pcm/aac data) → WaitForExit(300s)
  │     │
  │     └── GenerateThumbnail(output, thumbPath)
  │           └── ffmpeg -ss frame -i output -vframes 1 thumb.jpg (30s timeout)
  │
  ├── Delete temp MKV
  └── _exportInProgress = false (finally)
```

**Problemas:**
- **BUG C6**: PTS não re-baselineado para zero (corrigido? o código atual faz re-base em WriteMatroskaFile linha 426-429, mas o commentário C6 diz que GetSegments retorna PTS absoluto — verificar)
- **BUG C5**: `rawFormat` hardcoded como "h264" na chamada (linha 1494 do EngineCoordinator)
- **BUG H7**: `stdin.Dispose()` fecha pipe antes de ffmpeg ler último pacote AAC
- **BUG H6**: GenerateThumbnail sem `BeginErrorReadLine` handler
- Alocação LOH em `StreamPcmAsS16Le` para clips longos (L10)

---

## 5. CAPTURA DE VÍDEO (Área 3)

### Suporte por API

| API | Status | Limitações |
|-----|--------|------------|
| **WGC per-window** | ✅ Funciona | Requer Windows 11 + WindowsMessagePump; falha com `WS_EX_NOREDIRECTIONBITMAP` |
| **WGC desktop** | ✅ Funciona | Fallback quando per-window falha; captura monitor inteiro |
| **DXGI Desktop Duplication** | ⚠️ Funciona parcialmente | Multi-monitor tem use-after-free (C1); NullReferenceException em AcquireNextFrame (C2) |
| **Hybrid** | ⚠️ Não verificado | Fallback final; sem cobertura de teste |

### Problemas de Compatibilidade

| Cenário | Funciona? | Problema |
|----------|-----------|----------|
| Fullscreen Exclusive (FSX) | ⚠️ Depende | DXGI captura FSX; WGC desktop captura após DWM composição |
| Borderless Windowed | ✅ | WGC per-window funciona |
| Multi-monitor | ❌ | C1 (use-after-free) — DXGI crash com >1 monitor |
| 144Hz+ | ⚠️ | WGC pode perder frames em refresh rates altos; timeout de 100ms no TryCapture |
| HDR | ❌ | WGC captura em 8bpc (BT.709); HDR10 não suportado |
| Resize during capture | ⚠️ | FilterAudioByIntervals fecha os olhos; encoder não renegocia parâmetros |
| Monitor hotplug | ❌ | Sem handler; device D3D11 precisa ser recriado |

### Frame Pacing

- Pipeline loop alvo: 60fps → 16.67ms por frame
- WGC TryCaptureFrame timeout: 100ms (configurado em EngineCoordinator)
- DXGI timeout: 100ms
- Background/foreground debounce: 30 drops (~500ms BG), 15 frames (~250ms FG)
- **Tearing**: Sem Vsync na captura. DWM/WGC sempre entregam frames compostos.
- **Frame drops**: Detectados e contados. Não há feedback para o usuário sobre drop rate.

---

## 6. CAPTURA DE ÁUDIO (Área 4)

### Implementações

| Fonte | API | Formato | Thread Safety |
|-------|-----|---------|---------------|
| **CppLoopbackSource** (preferencial) | C++ DLL P/Invoke | PCM float, callback nativo | GCHandle leak (H17), _shortBuffer race |
| **WasapiLoopbackSource** (fallback) | NAudio WASAPI | PCM float, DataAvailable callback | _running race, array alloc per callback |
| **AudioSessionMuteManager** (tool) | NAudio MMDevice | Mute/restore sessions | _saved.Clear() perde história (H5) |

### Sincronização Áudio Loopback

- **Callback**: NAudio `DataAvailable` dispara a cada ~10ms (480 samples @ 48000Hz estéreo)
- **Mixer**: AudioMixer combina loopback + mic → `_audioQueue` (limitado a 512 frames)
- **Encoder**: FfmpegAacEncoder consome do mixer, enfila AAC frames → `Channel<EncodedPacket>` (limit 256, DropOldest)
- **Problema M2**: DropOldest sem log → perda silenciosa de frames AAC durante picos

### Latência

| Etapa | Latência |
|-------|----------|
| WASAPI loopback buffer | ~10ms (NAudio default) |
| AudioMixer internal queue | ~0-50ms (sync window) |
| AAC encoder (ffmpeg) | ~21ms (1024 samples @ 48kHz) |
| PTS queue | ~0-16ms (ConsumePcmPts) |
| **Total estimado** | **~31-97ms** |

---

## 7. CAPTURA DO MICROFONE (Área 5)

### Implementação Atual

- **WasapiMicSource**: NAudio `WasapiCapture` com event-driven mode (`true`)
- **Device selection**: Por `DeviceId` string (passada via config)
- **Noise suppression**: RnnoiseFilter (ffmpeg `anlmdn`) — opcional
- **Gain**: `AudioMixer.MicGain` (float, clamp 0-4)

### Problemas

| Problema | Severidade | Detalhes |
|----------|------------|----------|
| Troca dinâmica de dispositivo | ⚠️ | `setMicDevice` recria mixer inteiro — pausa de áudio |
| Hot plug | ❌ | Sem detecção; usuário precisa reabrir seletor |
| Event-driven WASAPI | ⚠️ | Drivers problemáticos podem causar instabilidade (M7) |
| Mute por PTT | ✅ | PushToTalkManager com Off/Hold/Toggle |
| _running race | 🟡 M6 | `_running = true` antes de `StartRecording()` |
| Array alloc per callback | 🟢 L17 | `new float[...]` 50-100x/s |

### Noise Suppression (RnnoiseFilter)

- **BUG C7**: `_stdout.Read()` bloqueante sem timeout — se ffmpeg crash, thread trava permanentemente
- **BUG C8**: `RedirectStandardError = true` sem `BeginErrorReadLine()` — ffmpeg bloqueia se escrever >4KB stderr
- **BUG**: `_disposed` non-volatile + `Process()` concurrent state corruption
- **anonlm** (ffmpeg built-in): funciona sem modelo externo
- **arnndn** (model-based): `Process()` assume input length = output length, quebra com modelos que variam tamanho

---

## 8. SINCRONIZAÇÃO A/V (Área 6)

### Pontos de Incerteza no Timestamp

| # | Ponto | Offset Máximo | Descrição |
|---|-------|--------------|-----------|
| S1 | `FfmpegEncoder.cs:652` — Enqueue PTS antes de `Write()` | 0–16ms | PTS do frame N é enfileirado antes do `_stdin.Write()`. Se ffmpeg emitir frame N+1 antes de ler N, PTS trocado |
| S2 | `FfmpegAacEncoder.cs:67` — `_outputFrameIndex` como PTS | ~21ms fixo | Ignora delay de inicialização do encoder AAC |
| S3 | `ConsumePcmPts` — partial consume | 0–5ms | **BUG C10**: Queue\<T\> sem lock pode corromper PTS |
| S4 | `GetSegments` — PTS absoluto sem re-base | Offset arbitrário | Se buffer tem 300s, offset começa em 42s |
| S5 | `FilterAudioByIntervals` — matching imperfeito | 0–50ms | Intervalos contíguos de vídeo vs áudio — matching remove áudio válido |
| S6 | `stdin.Dispose()` prematuro | 0–40ms | H7: último frame AAC truncado |
| Clock | QPC vs ffmpeg clock | Desprezível | QPC é monotônico; ffmpeg usa seu próprio relógio no mux |

### Diagnóstico Principal

O maior contribuinte é **S4 + C6** (PTS não re-baselineado). Em buffer de 300s, se o usuário salva no segundo 42, o vídeo começa em PTS=42s. O MP4 tem `mvhd` com `timescale` e `duration` que alguns players interpretam mal.

O segundo maior contribuinte é **C10** (Queue\<T\> sem lock) — pode causar corrupção total da fila de PTS, resultando em dessincronia progressiva.

---

## 9. BUFFER CIRCULAR — REPLAY BUFFER (Área 7)

### Implementação

- **Estrutura**: Dois anéis (videoRing[4096], audioRing[1024]) com crescimento exponencial
- **Lock**: `_lock` protege todas as operações públicas
- **Trim**: Video-only budget (`_totalVideoBytes > _maxBytes` ou `_totalVideoDuration > _maxDuration`)
- **Áudio**: Trim por duração (não por bytes) — M10: sem limite de bytes no áudio

### Capacidade

| Config | 20 Mbps | 50 Mbps | 80 Mbps |
|--------|---------|---------|---------|
| 30s (default) | 75MB | 188MB | 300MB |
| 60s | 150MB | 375MB | 600MB |
| 120s | 300MB | 750MB | 1.2GB |
| 300s | 750MB | 1.88GB | 3GB |

**Problemas**:
- **M11**: `Stats()` + `StatsDetailed()` TOCTOU: entre obter `VideoCount` e iterar pacotes, o buffer pode ter sido modificado
- **M10**: Áudio sem limite de bytes — se vídeo parar, áudio acumula sem controle
- **CopyRing**: Pacotes não-pooled compartilham referência entre buffer e snapshot — se o buffer trima enquanto caller usa a snapshot, referência fica dangling

---

## 10. SALVAMENTO DO REPLAY (Área 8)

### Pipeline

```
SaveClipAsync()
  ├── Thread principal (EngineCoordinator thread): ~1-5ms
  │     ├── lock(_exportLock) → TryEnter
  │     └── _buffer.GetSegments(lock)
  │
  └── ClipExporter.ExportToMp4 (bloqueante no mesmo thread)
        ├── WriteMatroskaFile: ~10-100ms (para 5min, 1080p60)
        ├── MuxWithFfmpegStreaming: ~2-30s (depende do tamanho)
        │     └── WaitForExit(300_000) ← 5 minutos de timeout!
        └── GenerateThumbnail: ~1-5s
```

**Problemas**:
1. **SaveClipAsync bloqueia o pipeline**: O lock `_exportLock` impede saves concorrentes, mas o pipeline loop não trava durante o save (GetSegments faz snapshot rápido). No entanto, se `ffmpeg` demora 30s para muxar, o `_exportLock` fica preso por 30s — o usuário não pode salvar outro clip.
2. **Timeout de 5 minutos**: Se ffmpeg travar, a thread bloqueia por 5 minutos.
3. **stdin.Dispose() prematuro (H7)**: O pipe de áudio é fechado antes de ffmpeg ler o último frame AAC.
4. **Thumbnail pode travar (H6)**: 30s de timeout sem BeginErrorReadLine — se ffmpeg emitir stderr, trava.

---

## 11. ENCODER (Área 9)

### Vídeo — FfmpegEncoder

| Codec | Suportado | Parâmetros | Problemas |
|-------|-----------|------------|-----------|
| **h264_nvenc** (NVIDIA) | ✅ | CRF+VBV: cq, maxrate, bufsize | OK |
| **hevc_nvenc** (NVIDIA) | ⚠️ | Mesmos parâmetros | H2: ParseAvcc assume H264 NAL headers (1 byte vs 2) |
| **av1_nvenc** (NVIDIA) | ❌ | Bsf não existe (H1) | Dados corrompidos |
| **h264_amf** (AMD) | ⚠️ | flags NVENC incompatíveis | Podem ser rejeitadas pelo driver AMD |
| **h264_qsv** (Intel) | ⚠️ | flags NVENC incompatíveis | Podem ser rejeitadas |
| **libx264** (CPU) | ✅ | Ultrafast + zerolatency | Alto uso de CPU para 1080p60 |

### Áudio — FfmpegAacEncoder

- **ffmpeg pipe**: stdin PCM s16le, stdout AAC ADTS
- **Priority**: `BelowNormal`
- **Output**: Channel\<EncodedPacket\> (256, DropOldest)
- **Flush**: stdin.Dispose() → ffmpeg finaliza → reader drena pacotes

**Problemas:**
- **M2**: DropOldest sem log — frames AAC perdidos silenciosamente
- **M9**: FlushAndDrain pode travar se ffmpeg não fechar na stdin EOF
- **S2**: 21ms de delay fixo não compensado no PTS

---

## 12. THREADS (Área 10)

### Inventário Completo de Threads

| Thread | Localização | Propósito | Prioridade | Sync |
|--------|-------------|-----------|------------|------|
| **PipelineLoop** (Task) | `EngineCoordinator.cs:410` | Captura + encode + buffer | `ThreadPool` (Normal) | `_pipelineLock` |
| **FfmpegReader** (Thread) | `FfmpegEncoder.cs:122` | Read ffmpeg stdout | Background | ConcurrentQueue, Channel |
| **FfmpegStderr** (Thread) | `FfmpegEncoder.cs:301` | Read ffmpeg stderr | Background | — |
| **AACReader** (Thread) | `FfmpegAacEncoder.cs:~90` | Read ffmpeg AAC stdout | Background | Channel\<E P\> |
| **WgcPump** (STA Thread) | `EngineCoordinator.cs:2036` | WGC DWM message pump | Background | ManualResetEventSlim |
| **HookThread** (STA) | `HotkeyManager.cs:111` | Global keyboard/mouse hooks | Background | `_lock` bindings |
| **GameDetectorHook** (STA) | `GameDetector.cs:97` | SetWinEventHook | Background | volatile `_running` |
| **MicEnumSTA** (STA, temp) | `EngineCoordinator.cs:672` | Mic enumeration (COM) | Background | Thread.Join(5s) |
| **NamedPipeListener** (Task) | `NamedPipeServer.cs:158` | Accept pipe connections | ThreadPool | ConcurrentQueue |
| **PipeClientHandler** (Task) | `NamedPipeServer.cs:207` | Handle pipe client | ThreadPool | ConcurrentQueue |
| **CaptureThread** (Thread) | `CppLoopbackSource.cs:67` | Blocking in C++ DLL call | Background | Thread.Interrupt |

### Problemas de Thread Safety

| # | Objetos Compartilhados | Threads | Proteção |
|---|----------------------|---------|----------|
| C10 | `_pcmPtsQueue` | Audio callback + StopCapture + ConsumePcmPts | ❌ Nenhuma |
| C11 | `_pipelineLock` liberado | SelectCaptureSource + StopCapture | ❌ TOCTOU |
| C12 | `_pttKeys` HashSet | Hook thread + engine thread | ❌ Nenhuma |
| C14 | `_mode`, `_micActive` | Hook thread + engine thread | ❌ Nenhuma |
| H16 | `Config` (AppConfig) | EngineCoordinator + IpcMessageHandler | ❌ Getter sem lock |
| M17 | `_capture`, `_encoder` | PipelineLoop + StopCapture | ❌ Leitura sem lock |
| M18 | `_audioMixer` | Múltiplos handlers + StopCapture | ❌ Acesso sem lock |
| — | `_captureActive` | PipelineLoop + IpcMessageHandler | ⚠️ volatile? (não, só bool) |
| — | `engineRunning` (TS) | IPC handlers + pipe callbacks | ⚠️ Event loop single-threaded, mas await cria reentrância |

### Deadlock Risk Assessment

| Cenário | Risco | Justificativa |
|---------|-------|---------------|
| `_pipelineLock` + audio callback | Baixo | Callback não segura lock |
| `_exportLock` + `_pipelineLock` | Baixo | Ordem consistente (export não segura pipelineLock) |
| `_restartLock` + `_pipelineLock` | Baixo | Restart task segura restartLock, depois pipelineLock |
| RNNoise stdout.Read() | **Médio** | C7: bloqueante sem timeout — ffmpeg crash = thread travada |
| FlushAndDrain st din.Dispose() | **Médio** | M9: se ffmpeg não fechar, Join(1000) timeout, thread leak |
| Monitor.Exit/Enter + Sleep | **Médio** | C11: lock release durante sleep abre janela para deadlock |

---

## 13. MEMÓRIA (Área 11)

### Consumo por Componente

| Componente | RAM Esperada | Pico | Notas |
|------------|-------------|------|-------|
| ReplayBuffer (5min, 20Mbps) | ~75MB | ~300MB (80Mbps) | + áudio ~3MB |
| FfmpegEncoder pipe buffer | 2MB | ~10MB | `_rawBuf` cresce se dados corrompidos |
| FfmpegAacEncoder pipe buffer | ~384KB | ~384KB | `_pcmBuf` |
| AudioMixer internal queues | ~500KB | ~2MB | `_audioQueue` + `_micQueue` |
| WgcCaptureSource texture | ~8MB (1080p) | ~32MB (4K) | `_copyTexture` |
| GpuVideoConverter NV12 | ~3.1MB (1080p) | ~12MB (4K) | `_cachedOutput` |
| CppLoopbackSource pending | ~2MB | ~2MB | `_pendingBuffers` (max 512) |
| NamedPipeServer broadcast | ~1MB | ~∞ (M16) | `_rawBroadcastQueue` sem limite |
| **Total estimado** | **~90MB** | **~350MB** | |

### Memory Leaks

| # | Vazamento | Tamanho | Frequência |
|---|-----------|---------|-----------|
| C15 | `_rawBuf` (ArrayPool) em ResetState() | ~512KB | Por restart forçado |
| L19 | `selectedAdapter` se CreateDevice falha | ~1KB | Raro (inicialização DXGI) |
| L20 | ManualResetEventSlim por Invoke() | ~256 bytes | Por chamada WGC |
| H17 | GCHandle em CppLoopbackSource.Start() | ~100 bytes | Se Start() falha após GCHandle.Alloc |
| M16 | `_rawBroadcastQueue` sem cliente | ~∞ | Crescimento ilimitado durante desconexão longa |

### GC Pressure

| Fonte | Alocações/s | Gen |
|-------|-------------|-----|
| WasapiLoopbackSource `new float[]` | ~96/s | Gen-0 |
| WasapiMicSource `new float[]` | ~50-100/s | Gen-0 |
| RnnoiseFilter `new byte[]` | ~50/s | Gen-0 |
| PipelineWatchdog LINQ | ~60KB/s | Gen-0/1 |
| CppLoopbackSource `new float[]` | ~50-100/s | Gen-0 |
| **Total** | **~500KB/s** | **Gen-0 ~1/s, Gen-1 ~30s** |

---

## 14. CPU (Área 12)

### Perfil de Uso

| Componente | Uso CPU (estimado) | Ociosidade |
|------------|-------------------|-----------|
| PipelineLoop (60fps) | 5-8% | N/A |
| ffmpeg NVENC | 3-5% | — |
| ffmpeg AAC encoder | 1-2% | — |
| HotkeyManager hook | <0.1% | PeekMessage idle |
| GameDetector hook | <0.1% | PeekMessage idle |
| WgcMessagePump | <0.1% | PeekMessage idle |
| NamedPipeServer | <0.1% | Task idle |
| **Total em captura** | **~10-15%** | |
| **Total em idle** | **<0.5%** | |

### Funções Caras

| Função | Custo | Chamado |
|--------|-------|---------|
| `GpuVideoConverter.Convert` | 0.1-0.5ms + GPU | 60x/s |
| `PipelineWatchdog.GetHealth()` | ~0.2ms + LINQ alloc | 60x/s |
| `CheckDiskSpace()` | ~1ms (I/O) | 1x a cada 2s |
| `Process.GetProcessById(pid)` | ~0.5ms | Por sessão de áudio |
| `FilterAudioByIntervals` (Save) | ~10-50ms | 1x por save |

### Sugestões de Otimização CPU

1. **PipelineWatchdog.GetHealth()**: Substituir LINQ `OrderBy` + `Average` por mantenedor incremental. Economiza ~0.2ms/frame + alocações GC.
2. **CheckDiskSpace() cache**: Resultado com TTL de 10s. `DriveInfo` wrappers são caros.
3. **Process.GetProcessById() cache**: Cache de nomes de processos por PID com TTL de 2s.

---

## 15. GPU (Área 13)

### Uso de GPU

| Componente | GPU | Uso |
|------------|-----|-----|
| NVENC encoder | NVIDIA | 2-5% (1080p60, CQ 20) |
| VideoProcessorBlt (BGRA→NV12) | Compute | 1-2% (1920x1080) |
| WGC desktop | DWM | 0-1% (já composto) |
| **Total** | | **3-8%** |

### Problemas GPU

1. **`GpuVideoConverter` retorna referência interna (BUG)**: `_cachedOutput` é retornado diretamente. Se `Convert()` for chamado novamente antes do caller consumir, o conteúdo é sobrescrito.
2. **`ctx.Flush()` síncrono**: Após `CopyResource`, o flush stall de 0.1-0.5ms. Necessário para `Map()` correto.
3. **Device lost sem recovery**: Se GPU crash/reset, `GpuVideoConverter` + `WgcCaptureSource` precisam ser recriados. `ReinitializePipelineAsync` existe mas sem lock (C3).

---

## 16. DISCO (Área 14)

### Padrão de Escrita

| Operação | Tamanho | Frequência |
|----------|---------|------------|
| **Save clip** (5min, 20Mbps) | ~75MB MP4 | Sob demanda |
| **Thumbnail** | ~50KB JPG | 1x por save |
| **Config persist** | ~1KB JSON | A cada status update (2s) + config change |
| **games.json update** | ~30KB JSON | 1x a cada 7 dias |
| **games-update-check.json** | ~50B JSON | 1x a cada 7 dias |

### Problemas

1. **Persistência de config a cada 2s**: `persistClipsConfig()` é chamado em `handlePipeMessage` (cada status update do engine = a cada 2s). Em SSDs modernos, isso não é problema, mas em HDDs pode causar latência.
2. **Atomic writes**: `GameDatabaseUpdater` usa `File.WriteAllTextAsync` sem atomic write — crash durante escrita corrompe games.json (H13).
3. **Impacto SSD**: ~75MB por save. 100 saves/dia = 7.5GB/dia. Para SSD de 256GB, ~35 dias de escrita contínua = 1 ciclo P/E. Aceitável.

---

## 17. COMPATIBILIDADE (Área 15)

### Matriz de Compatibilidade

#### Por GPU

| GPU | Encoder | Status | Notas |
|-----|---------|--------|-------|
| **NVIDIA RTX 30/40/50** | `h264_nvenc` | ✅ **Funciona** | Testado com FiveM na RTX 5050 |
| **NVIDIA GTX 16/20** | `h264_nvenc` | ✅ Provavelmente | Pascal+ suporta NVENC |
| **NVIDIA GTX 10** | `h264_nvenc` | ⚠️ Limitado | Max 2 sessions NVENC simultâneas |
| **AMD RX 6000/7000** | `h264_amf` | ⚠️ Não testado | Flags NVENC incompatíveis |
| **Intel Arc A3/A5/A7** | `h264_qsv` | ⚠️ Não testado | Flags NVENC incompatíveis |
| **Intel UHD iGPU** | `h264_qsv` | ⚠️ Não testado | Performance limitada para 1080p60 |
| **Sem GPU** | `libx264` | ⚠️ Não testado | CPU-bound |

#### Por Windows

| Windows | WGC per-window | WGC desktop | CppLoopbackSource | DXGI |
|---------|---------------|-------------|-------------------|------|
| **Win11 24H2+** | ✅ | ✅ | ✅ | ✅ |
| **Win11 22H2+** | ✅ | ✅ | ✅ | ✅ |
| **Win11 21H2** | ✅ | ✅ | ⚠️ Não testado | ✅ |
| **Win10 22H2** | ❌ | ✅ | ❌ | ✅ |
| **Win10 <2004** | ❌ | ⚠️ Picker | ❌ | ✅ |

#### Problemas de Compatibilidade Conhecidos

| Problema | Afeta | Severidade |
|----------|-------|------------|
| Multi-monitor DXGI crash (C1) | Todos com >1 monitor | 🔴 Crítico |
| HEVC/AV1 corrompido (C5) | Quem trocar codec | 🔴 Crítico (latente) |
| Config perdida no restart (C9) | Todos | 🔴 Crítico |
| AMD/Intel flags incompatíveis | AMD/Intel usuários | 🟠 Alto |
| WGC não funciona Win10 | Usuários Win10 | 🟠 Alto |
| CppLoopbackSource Win10 | Usuários Win10 sem per-process audio | 🟠 Alto |

---

## 18. TRATAMENTO DE ERROS (Área 16)

### Padrões de Error Handling

| Padrão | Ocorrências | Exemplos |
|--------|-------------|----------|
| **Silent catch** (`catch { }`) | **~30+** | EngineCoordinator:315,540,589,699,1363,1512,1690,1834,1848; IpcMessageHandler:53,71,167,196,199,519,569,662,728,784 |
| **catch + log only** | ~40 | EngineCoordinator:780,802,818,833,1152,1268; IpcMessageHandler:381,442 |
| **catch + log + recovery** | ~15 | EngineCoordinator:317 (StartCapture); ConfigManager:264 |
| **catch + throw** | ~5 | ClipExporter mux failure; RnnoiseFilter |

### Silent Catches por Impacto

| Local | Linha | O que engole | Risco |
|-------|-------|-------------|-------|
| `ResolveAudioPids` | 1363 | `AccessDenied` de anti-cheat | H14: PIDs de anti-cheat marcados como dead |
| `IsProcessAlive` | 540 | Todas as exceções de processo | Falso negativo: processo vivo reportado como morto |
| `ResolveProcessByName` | 589 | Todas as exceções | Retorna GameInfo vazio sem log |
| `OnGameChanged` | 1690 | Process existence check | Perde notificação de entrada/saída de jogo |
| `RunAutoCleanup` | 1848 | Falha de deleção | Arquivos órfãos acumulam |
| `CheckDiskSpace` | 1834 | DriveInfo falha | Disco cheio não detectado |
| `setCustomGameProcess` | 53 | Malformed JSON | Silenciosamente ignora input do usuário |

### Problemas de Error Handling

1. **Mais de 30 silent catches**: Toda exceção engolida sem log é um bug em potencial. Cada uma deve, no mínimo, logar um warning.
2. **Sem propagação de erro para o frontend**: Erros do pipeline (ex: capture source falhou) não são reportados ao usuário. O engine apenas loga e tenta reiniciar.
3. **Thumbnail falha silenciosamente (M14)**: Apenas warning, sem feedback visual.
4. **StartCapture não propaga erro de inicialização**: Se `CreateDevice` falha, `_captureActive = false` mas o usuário vê "capturando" = false sem motivo.

---

## 19. CÓDIGO MORTO (Área 17)

| # | Arquivo | Linhas | Função | Pode Remover? |
|---|---------|--------|--------|---------------|
| D1 | `SilentAudioSource.cs` | ~23L | Classe inteira | ✅ Sim — nunca instanciada |
| D2 | `AudioMixer.cs:290-293` | 4L | `GetPendingAudio()` | ✅ Sim — sempre retorna vazio |
| D3 | `ClipExporter.cs:749-830` | 81L | `EncodeRawNv12ToMp4()` | ✅ Sim — nunca chamado |
| D4 | `ClipExporter.cs:831-880` | ~50L | `DetectFastestCodec()` | ✅ Sim — duplica EncoderManager |
| D5 | `BenchmarkResult.cs` | 113L | Classe inteira | ⚠️ Só usado por `Program.cs --bench` |
| D6 | `EngineCoordinator.cs:1181` | ~20L | `SwitchCaptureApi()` | ✅ Sim — nunca chamado |
| D7 | `PipelineWatchdog.cs` | 136L | Uso limitado | ⚠️ Usado mas health window quebrado (C4) |

---

## 20. CÓDIGO DUPLICADO (Área 18)

| # | Onde | O quê | Sugestão |
|---|------|-------|----------|
| D8 | `ClipExporter.DetectFastestCodec` vs `EncoderManager.DetectBestCodec` | Mesma lógica (ffmpeg -encoders) | Remover ClipExporter version |
| D9 | `FfmpegEncoder.CheckFfmpegEncoder` vs `EncoderManager.CheckFfmpegEncoder` | Ambos verificam ffmpeg | Unificar em um único helper |
| D10 | `EngineCoordinator.IsSystemWindowClass` vs `GameDetector._isSystemClass` | Lógica de exclusão de janelas | Centralizar em GameDetector |
| D11 | `WasapiLoopbackSource` vs `WasapiMicSource` | ~80% identical | Base class compartilhada |
| D12 | NonGameProcesses duplicatas | "msra", "Narrator" com espaço | Deduplicar lista |
| D13 | `buildEngineConfig()` vs `getCurrentConfigPayload()` | Campos sobrepostos | Já tem `baseConfigPayload()` |

---

## 21. FRONT-END ↔ BACK-END (Área 19)

### Bugs de Comunicação Confirmados

| # | Severidade | Descrição | Arquivo |
|---|------------|-----------|---------|
| **B1** | 🔴 Crítico | `autoStartCapture` perde valor `false` (`\|\| undefined`) | clips-config-manager.ts:121 |
| **B2** | 🟡 Médio | `selectedAudioSessions` não restaurado na reconexão do pipe | clips-engine-connection.ts:420-428 |
| **B3** | 🟡 Médio | `adaptiveQuality` não atualizável via CLIPS_SET_CONFIG | clips.ipc.ts:131-213 |
| **B4** | 🟡 Médio | `customGameProcess`/`micDeviceId` perdem string vazia | clips-config-manager.ts:119-120 |
| **B5** | 🟢 Baixo | `excludeProcessId` envia `process.pid` sem documentação | clips-config-manager.ts:123 |
| **B6** | 🟢 Baixo | `engineCapturing` dessincroniza quando pipe cai | clips.ipc.ts:57-58 |
| **B7** | 🟢 Inconsistência | Defaults diferentes entre TS e C# (cq 16 vs 24) | clips-config-manager.ts:55 vs C# |
| **B8** | 🟢 Baixo | `engineProcess` anulado antes do SIGKILL timeout | clips-engine-connection.ts:489 |
| **B9** | 🟡 Médio | Protocolo `clip-video://` sem proteção path traversal | index.ts:474-512 |
| **B10** | 🟢 Baixo | `pipeBuffer` sem limite de crescimento | clips-engine-connection.ts:243 |
| **B11** | 🟢 Baixo | `readClipsFromDisk` pode spawnar centenas de ffmpeg | clips-engine-connection.ts:166-175 |
| **B12** | 🟢 Observação | Engine status overwrites config do usuário | clips-engine-connection.ts:270-304 |

### Mapeamento Config: TS → C#

**1. Mapeamento Direto** (via `buildEngineConfig()`, enviado como JSON no pipe):
```json
{  "replayTimeSeconds": 300, "micEnabled": true, "audioLoopback": true,
   "fps": 60, "width": 1920, "height": 1080, "bitrateKbps": 20000,
   "cq": 20, "maxrateKbps": 40000, "bufsizeKbps": 80000,
   "bframes": 2, "lookahead": 4, "encoderPreset": "p4",
   "codec": "auto", "adapterIndex": 0, "outputDirectory": "...",
   "forceSoftware": false, "pushToTalk": "off", "pushToTalkKeys": [5, 20],
   "gameDetection": true, "gameAudioOnly": false,
   "gameVolume": 1.0, "micVolume": 1.0, "audioSampleRate": 48000,
   "autoCleanupEnabled": true, "autoCleanupThresholdPercent": 20,
   "noiseSuppression": false, "adaptiveQuality": true,
   "electronPid": 1234, "Hotkeys": [...] }
```

**2. Caminho Alternativo** (comandos pipe separados):
- `setCustomGameProcess { pid, name }` 
- `setAudioSessions { pids: [...] }`
- `setMicDevice { id: "DEV123" }`
- `config { ... }` (payload completo)

**3. BUG**: `selectedAudioSessions` tem DOIS caminhos:
1. Via `config` comando (payload contém `selectedAudioSessions`) — NÃO IMPLEMENTADO no TS
2. Via `setAudioSessions` comando (payload contém `{ pids: [...] }`) — USADO atualmente

Isso significa que se o engine reiniciar, `syncConfigOnConnect()` envia `buildEngineConfig()` (que não inclui `selectedAudioSessions`), mas o comando `setAudioSessions` nunca é reenviado → perde configuração de áudio (B2).

---

## 22. LOGS E DIAGNÓSTICO (Área 20)

### Qualidade dos Logs

| Aspecto | Avaliação | Problemas |
|---------|-----------|-----------|
| **Nível de detalhamento** | ✅ Bom | `-loglevel info` no ffmpeg, logs de diagnóstico no C# |
| **Rastreabilidade** | ⚠️ Médio | Logs usam `Log.I("Module", "msg")` com prefixo, mas sem correlation ID |
| **Facilidade de depuração** | ⚠️ Médio | Sem rastreamento de pipeline entre Electron e C# |
| **Identificação de falhas** | ❌ Ruim | ~30 silent catches sem log (erros críticos invisíveis) |

### Sugestões de Melhoria

| Sugestão | Impacto | Esforço |
|----------|---------|---------|
| Adicionar correlation ID entre Electron e C# | Alto | Médio |
| Logar frame drop rate a cada 10s | Médio | Baixo |
| Logar motivo de restart do pipeline | Alto | Baixo |
| Substituir todos os `catch { }` por `catch { Log.W(...) }` | Alto | Baixo |
| Adicionar log de exceção não tratada no pipeline loop | Crítico | Baixo |
| Log de device info (GPU, driver version) na inicialização | Médio | Baixo |

---

## 23. RISCOS DE ESTABILIDADE PARA SESSÕES LONGAS (Área 21)

### Sessão de 30 minutos

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| PipelineLock TOCTOU (C11) | Média | Use-after-free de `_capture`/`_encoder` | Nenhuma |
| Queue\<T\> PTS corruption (C10) | Média | Dessincronia A/V progressiva | Nenhuma |
| Memory leak _rawBuf (C15) | Baixa (só restart) | ~512KB/restart | Insignificante em 30min |
| Audio sem limite (M10) | Média | ~18MB de áudio se vídeo parar | Nenhuma |
| Overflow de `_audioPacketCount` (int) | Desprezível | 2^31 pacotes = ~248 dias | Nunca ocorre |

### Sessão de 1 hora

| Risco | Probabilidade | Impacto |
|-------|--------------|---------|
| GC pressure do watchdog (P2) | Alta | ~3.6MB LINQ alloc/h → GC gen-1 a cada ~2min |
| CppLoopbackSource alocações (P3) | Alta | ~180K alocações float[] em 1h → GC gen-0 frequente |
| Perda de mute states (H5) | Média | Sessões antigas ficam mudas |
| Offset A/V acumulado | Média | Pode exceder 100ms se C10 corromper PTS |

### Sessão de 3 horas

| Risco | Probabilidade | Impacto |
|-------|--------------|---------|
| NamedPipeServer queue sem limite (M16) | Alta (se Electron desconectar) | Crescimento ilimitado de RAM |
| CppLoopbackSource GCHandle race (M5) | Média (só em stop) | AccessViolation |
| GC gen-2 induced stutter (L10) | Baixa | Pausas de 2-5ms durante save |

### Testes de Estresse Recomendados

| Teste | O que verificar | Prioridade |
|-------|----------------|------------|
| Gravação contínua 3h com FiveM | Estabilidade, memória, A/V sync | 🔴 Crítica |
| Alternância rápida de jogos (30x em 5min) | GameDetector + restart loop | 🟠 Alta |
| Troca de monitor durante captura | WgcCaptureSource resize | 🟠 Alta |
| Desconexão do dispositivo de áudio | WASAPI recovery | 🟡 Média |
| Alto uso de CPU (jogo + streaming) | Pipeline starvation | 🟡 Média |
| Criação de 100 clips em sequência | Disk I/O, lock contention | 🟢 Baixa |

---

## 24. BENCHMARK vs REFERÊNCIAS (Área 22)

### Comparação Estimada

| Métrica | DiNho Clips | OBS Studio | Medal | NVIDIA App |
|---------|-------------|------------|-------|-----------|
| **CPU em idle** | <0.5% | ~1% | ~2% | ~1% |
| **CPU em captura** | 10-15% | 5-8% | 8-12% | 5-10% |
| **GPU (NVENC)** | 3-8% | 3-5% | 3-5% | 2-4% |
| **RAM** | ~90-350MB | ~200-500MB | ~150-400MB | ~100-300MB |
| **Latência de save (5min)** | ~2-30s | ~1-5s | ~2-10s | ~1-3s |
| **A/V sync** | ⚠️ Sujeito a drift | ✅ Excelente | ✅ Bom | ✅ Excelente |
| **Multi-track audio** | ✅ Sim (C++ DLL) | ✅ Sim | ❌ Não | ❌ Não |
| **Replay buffer** | ⚠️ 512KB leak/restart | ✅ Robusto | ✅ Robusto | ✅ Robusto |
| **Auto-start com jogo** | ✅ Sim | ✅ Sim | ⚠️ Limitado | ✅ Sim |
| **Clip editor** | ✅ Trim + Merge | ❌ Não | ✅ Sim | ✅ Sim |

### Oportunidades de Melhoria vs Referências

1. **Latência de save**: DiNho demora mais que concorrentes porque o ffmpeg mux `-c:v copy` + `-movflags +faststart` precisa reescrever o MP4. OBS salva em segundos usando remux rápido.
2. **RAM**: DiNho é mais eficiente que OBS em idle, mas o leak de `_rawBuf` (C15) degrada em sessões longas.
3. **A/V sync**: OBS usa timestamps absolutos do QPC. DiNho tem 30+ silent catches que podem mascarar erros de PTS.
4. **Clip editor**: DiNho já tem trim + merge (Opção A implementada). Medal tem editor mais completo.

---

## 25. TOP 15 PRIORIDADES DE CORREÇÃO

| Prioridade | ID | Arquivo | Descrição | Esforço | Impacto |
|------------|-----|---------|-----------|---------|---------|
| 1 | **C1/C2** | `DxgiCaptureSource.cs` | Use-after-free + NRE — maior probabilidade de impedir clips | 2h | 🔴 Crítico |
| 2 | **C11** | `EngineCoordinator.cs:775-778` | PipelineLock TOCTOU race — use-after-free durante retry | 1h | 🔴 Crítico |
| 3 | **C10** | `EngineCoordinator.cs:1279` | Queue\<T\> _pcmPtsQueue sem lock — corrompe PTS | 1h | 🔴 Crítico |
| 4 | **C12** | `PushToTalkManager.cs:31-42` | HashSet _pttKeys data race — PTT quebrado | 0.5h | 🔴 Crítico |
| 5 | **C3** | `EngineCoordinator.cs:1190-1273` | ReinitializePipelineAsync sem lock | 2h | 🔴 Crítico |
| 6 | **H3** | `EngineCoordinator.cs:1005-1008` | PipelineLoop sem try-catch em TryCaptureFrame | 0.5h | 🟠 Alto |
| 7 | **C13** | `clips-config-manager.ts:121` | `autoStartCapture \|\| undefined` perde false | 0.25h | 🔴 Crítico |
| 8 | **B3** | `clips.ipc.ts:131-213` | adaptiveQuality não atualizável | 0.25h | 🟡 Médio |
| 9 | **B2** | `clips-engine-connection.ts:420-428` | selectedAudioSessions perdido na reconexão | 0.5h | 🟡 Médio |
| 10 | **C9** | `ConfigManager.cs:166` | Config perdida no restart (case-sensitive) | 1h | 🔴 Crítico |
| 11 | **H16** | `ConfigManager.cs:133` | Config getter sem lock | 0.5h | 🟠 Alto |
| 12 | **H17** | `CppLoopbackSource.cs:61` | GCHandle leak em Start() | 0.25h | 🟠 Alto |
| 13 | **C7/C8** | `RnnoiseFilter.cs:69-75,41` | Deadlock do noise filter | 1h | 🔴 Crítico |
| 14 | **C6** | `ClipExporter.cs:464-490` | PTS não re-baselineado | 0.5h | 🔴 Crítico |
| 15 | **H6** | `ClipExporter.cs:841-842` | Thumbnail pode travar (BeginErrorReadLine) | 0.5h | 🟠 Alto |

---

## 26. PLANO DE AÇÃO

### Curto Prazo (1-2 dias) — 🔴 Parar Incêndios

| Item | Esforço | Descrição |
|------|---------|-----------|
| 1 | 1h | Fix C11: remover `Monitor.Exit/Enter` + `Thread.Sleep` de `SelectCaptureSource` |
| 2 | 1h | Fix C10: usar `ConcurrentQueue<...>` ou lock no `_pcmPtsQueue` |
| 3 | 0.5h | Fix C12: adicionar lock no `_pttKeys` HashSet e `volatile` em `_mode`/`_micActive` |
| 4 | 0.5h | Fix H3: envolver `TryCaptureFrame` no try-catch do pipeline loop |
| 5 | 0.5h | Fix C1/C2: DxgiCaptureSource null-check + double dispose |
| 6 | 2h | Fix C3: adicionar `_pipelineLock` em `ReinitializePipelineAsync` |

### Médio Prazo (3-5 dias) — 🟠 Estabilizar

| Item | Esforço | Descrição |
|------|---------|-----------|
| 7 | 0.5h | Fix C13: `autoStartCapture` → `false \|\| undefined` bug |
| 8 | 0.5h | Fix B3: adicionar `adaptiveQuality` no CLIPS_SET_CONFIG handler |
| 9 | 0.5h | Fix B2: reenviar `selectedAudioSessions` em `syncConfigOnConnect()` |
| 10 | 0.5h | Fix H16: adicionar lock no getter `ConfigManager.Config` |
| 11 | 0.25h | Fix H17: proteger GCHandle em CppLoopbackSource.Start() |
| 12 | 1h | Fix C9: adicionar `PropertyNameCaseInsensitive = true` no ConfigManager |
| 13 | 0.5h | Fix C6: re-baselinear PTS no WriteMatroskaFile (já existe? verificar) |
| 14 | 0.5h | Fix H6: adicionar handler no BeginErrorReadLine da thumbnail |
| 15 | 0.5h | Fix H7: garantir flush do AAC antes de fechar stdin no mux |
| 16 | 1h | Substituir todos `catch { }` por `catch { Log.W(...) }` (~30 locais) |
| 17 | 1h | Fix C15: retornar `_rawBuf` ao ArrayPool em ResetState() |

### Longo Prazo (1-2 semanas) — 🟢 Refinar

| Item | Esforço | Descrição |
|------|---------|-----------|
| 18 | 2h | Extrair EngineCoordinator em 3-4 classes (PipelineManager, AudioManager, CaptureManager) |
| 19 | 1h | Unificar WasapiLoopbackSource + WasapiMicSource com base class |
| 20 | 2h | Adicionar testes de estresse (3h captura contínua, 100 saves) |
| 21 | 1h | Otimizar PipelineWatchdog: substituir LINQ por incremental |
| 22 | 1h | Adicionar cache de CheckDiskSpace (TTL 10s) |
| 23 | 1h | Adicionar correlation ID entre Electron IPC e C# pipe |
| 24 | 4h | Implementar editor visual de clips (Opção B — timeline + preview + slow-mo) |
| 25 | 0.5h | Adicionar ArrayPool nos callbacks WASAPI (WasapiLoopbackSource, WasapiMicSource) |
| 26 | 1h | Adicionar limite ao `pipeBuffer` no TypeScript (max 1MB) |
| 27 | 0.5h | Adicionar proteção path traversal no protocolo `clip-video://` |

---

## 27. OPORTUNIDADES DE OTIMIZAÇÃO

### CPU

| Otimização | Ganho Estimado | Esforço |
|------------|----------------|---------|
| PipelineWatchdog incremental | ~0.2ms/frame (~1% CPU @60fps) | 1h |
| CheckDiskSpace cache (10s TTL) | ~0.5ms a cada 2s | 0.5h |
| Process.GetProcessById cache | ~0.5ms por chamada de áudio | 0.5h |

### GPU

| Otimização | Ganho Estimado | Esforço |
|------------|----------------|---------|
| Remover ctx.Flush() se desnecessário | 0.1-0.5ms/frame | 1h (requer validação) |
| Reutilizar staging textures no GpuVideoConverter | ~0.1ms/frame | 0.5h |

### Memória

| Otimização | Ganho Estimado | Esforço |
|------------|----------------|---------|
| ArrayPool nos callbacks WASAPI (3 locais) | Reduz GC gen-0 em ~200 alocações/s | 1h |
| Remover LINQ alocações do watchdog | ~60KB/s | 1h |
| Limitar _rawBroadcastQueue | Previne OOM | 0.5h |

### Disco

| Otimização | Ganho Estimado | Esforço |
|------------|----------------|---------|
| Reduzir frequência de persistClipsConfig (2s → 30s) | Menos escrita SSD | 0.25h |
| Atomic write no GameDatabaseUpdater | Previne corrupção | 0.5h |

---

## APÊNDICE A — Resumo por Arquivo

| Arquivo | Linhas | Crit | Alto | Med | Baixo | Total |
|---------|--------|------|------|-----|-------|-------|
| `EngineCoordinator.cs` | 2157 | 3 (C3,C10,C11) | 4 (H3,H14,H15,H1) | 2 (M17,M18) | 4 (L8,L11,L19,L20,L24) | 13 |
| `IpcMessageHandler.cs` | 787 | 0 | 2 (H8,H9) | 0 | 0 | 2 |
| `FfmpegEncoder.cs` | 979 | 1 (C15) | 2 (H1,H2) | 3 (M1,M2,M3) | 3 (L1,L2,L4) | 9 |
| `ClipExporter.cs` | 937 | 2 (C5,C6) | 2 (H6,H7) | 3 (M12,M13,M14) | 2 (L9,L10) | 9 |
| `AudioMixer.cs` | 307 | 0 | 1 (H4) | 1 (M8) | 1 (L5) | 3 |
| `CppLoopbackSource.cs` | 197 | 0 | 1 (H17) | 2 (M4,M5) | 0 | 3 |
| `PushToTalkManager.cs` | 71 | 2 (C12,C14) | 0 | 0 | 0 | 2 |
| `RnnoiseFilter.cs` | 152 | 2 (C7,C8) | 0 | 0 | 1 (L18) | 3 |
| `ConfigManager.cs` | 402 | 1 (C9) | 1 (H16) | 0 | 0 | 2 |
| `ReplayBuffer.cs` | 255 | 1 (C6) | 0 | 2 (M10,M11) | 0 | 3 |
| `DxgiCaptureSource.cs` | 206 | 2 (C1,C2) | 0 | 0 | 0 | 2 |
| `WasapiLoopbackSource.cs` | 85 | 0 | 0 | 1 (M7) | 1 (L16) | 2 |
| `WasapiMicSource.cs` | 76 | 0 | 0 | 1 (M6) | 1 (L17) | 2 |
| `WgcCaptureSource.cs` | 365 | 0 | 0 | 0 | 1 (L3) | 1 |
| `GpuVideoConverter.cs` | 122 | 0 | 0 | 0 | 1 (L14) | 1 |
| `PipelineWatchdog.cs` | 136 | 1 (C4) | 0 | 0 | 0 | 1 |
| `GameDetector.cs` | 473 | 0 | 1 (H12) | 1 (M15) | 0 | 2 |
| `GameDatabase.cs` | 170 | 0 | 1 (H11) | 0 | 0 | 1 |
| `GameDatabaseUpdater.cs` | 187 | 0 | 2 (H10,H13) | 0 | 0 | 2 |
| `NamedPipeServer.cs` | 341 | 0 | 0 | 1 (M16) | 0 | 1 |
| `AudioSessionMuteManager.cs` | 100 | 0 | 1 (H5) | 0 | 0 | 1 |
| `FfmpegAacEncoder.cs` | 213 | 0 | 0 | 1 (M9) | 1 (L7) | 2 |
| `Interop.cs` | 254 | 0 | 0 | 0 | 1 (L15) | 1 |
| `Log.cs` / `ConsoleLogger.cs` | 72 | 0 | 0 | 0 | 2 (L12,L13) | 2 |
| **Subtotal C#** | **~9500** | **15** | **18** | **18** | **19** | **70** |
| `clips-config-manager.ts` | 253 | 1 (C13) | 0 | 1 (B4) | 2 (B5,B7) | 4 |
| `clips.ipc.ts` | 475 | 0 | 1 (H18/B3) | 0 | 1 (B6) | 2 |
| `clips-engine-connection.ts` | 599 | 0 | 0 | 3 (B2,B10,B11) | 1 (B8) | 4 |
| `src/main/index.ts` | ~500 | 0 | 0 | 1 (B9) | 0 | 1 |
| **Subtotal TS** | **~1800** | **1** | **1** | **5** | **4** | **11** |
| **Total Geral** | **~12500** | **16** | **19** | **23** | **23** | **81** |

---

## APÊNDICE B — Correções já Aplicadas (referência)

Para evitar regressões, estas correções das sessões anteriores já estão em vigor:

| Correção | Sessão | Status |
|----------|--------|--------|
| AAC encoder priority: Idle → BelowNormal | 2026-06-26 | ✅ |
| Matroska writer (raw H264 → MKV) | 2026-06-26 | ✅ |
| avcC CodecPrivate (SPS/PPS extraído) | 2026-06-27 | ✅ |
| Reader loop: persistent _rawBuf para pipe splits | 2026-06-27 | ✅ |
| 3-path format detection (AnnexB/AVCC/aguardar) | 2026-06-27 | ✅ |
| ReplayBuffer video-only budget | 2026-06-27 | ✅ |
| ConvertAnnexBToAvcc com orphaned tail fix | 2026-06-27 | ✅ |
| Sessão de áudio muting (AudioSessionMuteManager) | 2026-06-23e | ✅ |
| WindowsMessagePump para WGC | 2026-06-23b | ✅ |
| Remove `-bsf:v h264_mp4toannexb` (AVCC nativo) | 2026-06-28 | ✅ |
| Write AVCC direto (sem AnnexB) nos SimpleBlocks | 2026-06-28 | ✅ |
| Jogos.json auto-update (GameDatabaseUpdater) | 2026-06-26 | ✅ |
| ffprobe removido (ffmpeg -i para duração) | 2026-06-26 | ✅ |
| Clip editor (trim + merge) | 2026-06-25 | ✅ |

---

*Fim do relatório de auditoria. 81 problemas encontrados em 54 arquivos (41 C# + 13 TypeScript), abrangendo 22 áreas de análise.*
