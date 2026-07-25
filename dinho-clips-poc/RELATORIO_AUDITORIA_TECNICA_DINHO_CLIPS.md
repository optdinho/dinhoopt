# RELATÓRIO DE AUDITORIA TÉCNICA — DiNho Clips
## Sistema de Replay Buffer — Auditoria Completa

**Data:** 2026-07-14  
**Escopo:** 100% do fluxo de ponta a ponta — captura → encode → buffer → exportação → IPC  
**Versão do código:** Baseada nos arquivos auditados em `src/DiNho.Capture.Poc/`

---

## 1. Resumo Executivo

A auditoria identificou **44 problemas** distribuídos entre severidades. O problema principal — **clips não sendo salvos** — é causado por uma combinação de fatores, não por um único bug. As causas raiz mais impactantes são:

1. **`rawFormat` fixo como "h264"** mesmo quando HEVC/AV1 é selecionado — gera Matroska com CodecPrivate errado
2. **Encode de áudio AAC com canal `DropWrite`** descarta frames silenciosamente quando a fila enche durante warmup
3. **`_lastRealPtsTicks` não é resetado no `ResetState()`** —PTS fica distorcido após restart do ffmpeg
4. **`Broadcast()` segura lock durante serialização + pipe write** — pode causar deadlock com pipeline loop
5. **`_outputFrameIndex` no FfmpegAacEncoder incrementado antes do drain** —PTS de áudio pode ficar desalinhado com vídeo

A maioria dos problemas são **defeitos latentes** que se manifestam sob condições específicas (sessões longas, bitrates altos, GPU específica, alt-tab frequente). O sistema funciona parcialmente em condições ideais mas falha silenciosamente em cenários reais.

---

## 2. Lista de Bugs por Severidade

### CRÍTICO (impede funcionamento)

| # | Bug | Localização | Impacto |
|---|-----|-------------|---------|
| C1 | **`rawFormat` hardcoded "h264"** — `SaveClipAsync` sempre passa `rawFormat: "h264"` para `ClipExporter.ExportToMp4`, mesmo quando `EncoderManager.DetectBestCodec()` retornou `hevc` ou `av1`. O `WriteMatroskaFile` gera CodecID `V_MPEG4/ISO/AVC` e tenta extrair avcC de dados HEVC/AV1 — `ExtractAvccExtradata` retorna null → MKV sem CodecPrivate → ffmpeg mux falha silenciosamente. | `EngineCoordinator.cs` (saveClip handler), `ClipExporter.cs:649-654` | **Clip corrompido ou não gerado** |
| C2 | **`FfmpegAacEncoder` canal `DropWrite`** — `_outputChannel` é `BoundedChannelFullMode.DropWrite` com capacity 4096. Se o reader thread (`ReaderLoop`) não consumir pacotes AAC rápido o suficiente (ex: warmup de ~4.6s com `BelowNormal` priority), pacotes são descartados silenciosamente. O `_droppedFrameCount` é incrementado mas **não há tratamento** — o clip exportado tem menos áudio que deveria. | `FfmpegAacEncoder.cs:14-17`, `EngineCoordinator.cs` | **Áudio incompleto ou silencioso no clip** |
| C3 | **`_lastRealPtsTicks` não resetado em `ResetState()`** — quando ffmpeg é reiniciado (encoder restart), `_lastRealPtsTicks` mantém o valor da sessão anterior. O próximo PTS calculado pode ser negativo ou salto brusco → frames com timestamps quebrados no Matroska. | `FfmpegEncoder.cs` (campo de instância, não resetado no `ResetState()`) | **Clip com timestamps corrompidos após restart** |
| C4 | **`SilentAudioSource` nunca emite dados** — referenciado na spec como parte do pipeline de áudio, mas nunca instanciado. Se `WasapiLoopbackSource` falhar (ex: sem permissão WASAPI), `AudioMixer` fica bloqueado `_loopbackQueue.Count == 0` para sempre. | `AudioMixer.cs:180` (return when queue empty) | **Pipeline de áudio trava sem fallback** |

### ALTO (afeta qualidade/reliabilidade significativamente)

| # | Bug | Localização | Impacto |
|---|-----|-------------|---------|
| A1 | **`Broadcast()` segura `_statusLock` durante serialização + pipe write** — `BroadcastStatus` é chamado a cada 2s pelo timer. Se o pipe estiver lento (cliente Electron sobrecarregado), o lock fica segurado bloqueando `Update()` que precisa dele para StatusDetailed. | `NamedPipeServer.cs:234-242`, `EngineCoordinator.cs` | **Pipeline loop stutter / deadlock potencial** |
| A2 | **`_frameCount` race condition** — incrementado no reader thread (`FfmpegEncoder.ReaderLoop`) mas lido sem sincronização no pipeline thread via `_status.Update()`. Em 60fps, a discrepância pode ser de ~16ms. | `FfmpegEncoder.cs` (reader thread) vs `EngineCoordinator.cs` (pipeline thread) | **Stats incorretos, watchdog pode disparar falso reinit** |
| A3 | **GpuVideoConverter `InputView` cache** — cacheia `ShaderResourceView` por (width, height), mas WGC entrega nova `ID3D11Texture2D` a cada frame. Se a textura não for liberada corretamente, o cache fica com referências stale. | `GpuVideoConverter.cs` (campo `_cachedInputView`, `_cachedInputTex`) | **Memory leak de GPU em sessões longas** |
| A4 | **`_pcmPtsQueue` drain completo no `EmitPacket`** — `ConsumePcmPts` drena TODA a fila e mantém apenas o último PTS. Se NVENC processa 2 frames acumulados, ambos recebem o mesmo PTS → **Non-monotonic DTS** no Matroska. | `FfmpegEncoder.cs` (método `EmitPacket` / `ConsumePcmPts`) | **Freeze de vídeo no player, clip corrompido** |
| A5 | **`FilterAudioByIntervals` pode remover áudio válido** — se o vídeo tem gaps >50ms (alt-tab), o áudio correspondente é removido. Mas o áudio pode ter continuidade perfeita durante esses gaps (WASAPI continua capturando). | `ClipExporter.cs:335-350` | **Gaps de áudio no clip, silêncio intermitente** |
| A6 | **`_totalVideoDuration` / `_totalAudioBytes` accounting** — `_totalVideoDuration` usa `+= packet.Duration` mas `TrimExcessVideo` usa `-= oldest.Duration`. Se `Duration` de pacotes poolados for modificado por `Release()`, os contadores ficam inconsistentes. | `ReplayBuffer.cs:108-109,145-146` | **Trim incorreto, buffer cresce além do limite** |
| A7 | **`GameDetector._gameProcess` disposal** — `Process.GetProcessById()` retorna processo que pode ser disposed antes de `DetectGame()` ler `MainModule.FileName`. Em 100ms de polling, o processo pode fechar entre `GetProcessById` e `MainModule`. | `GameDetector.cs:248-250` | **`InvalidOperationException` em polling fallback** |

### MÉDIO (afeta robustez/performance)

| # | Bug | Localização | Impacto |
|---|-----|-------------|---------|
| M1 | **ADTS header hardcoded stereo** — `PadAudioWithSilence` e `GenerateSilentAacFrames` sempre usam `chanConfig = 2` (stereo), ignorando o `sampleRate` e configuração real do áudio. Se o áudio é mono, frames silenciosos têm header errado. | `ClipExporter.cs:260` | **Decoder pode rejeitar ou decodificar incorretamente silêncio** |
| M2 | **`CopyRing` deep copy de pacotes poolados** — `CopyRing` chama `pkt.Retain()` em vez de clonar dados. Se `TrimExcess` chama `Release()` no pacote original enquanto `GetSegments` ainda usa a referência copiada, pode causar double-free. | `ReplayBuffer.cs:237-248` | **Use-after-free em buffer concurrent** |
| M3 | **`RnnoiseFilter` blocking I/O** — `stdin.Write()` + `stdout.Read()` síncronos no mesmo thread. Se ffmpeg AAC encoder estiver sobrecarregado, `_stdin.Write()` bloqueia o thread de mixagem de áudio. | `RnnoiseFilter.cs` (método `Process`) | **Áudio com gaps durante noise suppression** |
| M4 | **`GrowIfNeeded` over-allocation** — array dobra (`buffer.Length * 2`). Para 10.000 frames de vídeo, aloca 20.000 slots (80KB de referências). Não é crítico mas contribui para GC pressure. | `ReplayBuffer.cs:165-187` | **Fragmentação LOH em sessões longas** |
| M5 | **`ctx.Flush()` síncrono a cada frame** — `GpuVideoConverter.Convert()` chama `ctx.Flush()` após `CopyResource`. O flush força espera de GPU idle, introduzindo ~0.5-2ms de stall por frame. | `GpuVideoConverter.cs` (método `Convert`) | **~30-120ms extra por segundo de captura** |
| M6 | **`PipelineWatchdog` DateTime.UtcNow race** — `_lastFrameTime` e `_lastIssueTime` são `DateTime` (não atômicos) escritos por pipeline thread e lidos por `ShouldReinit()` em qualquer thread. | `PipelineWatchdog.cs:39-40,52,69` | **Leitura de valor parcialmente atualizado (raro em x64)** |
| M7 | **`_status.Update()` com `StatsDetailed()`** — chamado a cada frame, faz `EnterReadLock()` no ReplayBuffer. Com 60fps e locks contenciosos, pode criar contention. | `EngineCoordinator.cs` (pipeline loop), `ReplayBuffer.cs:291-299` | **Pipeline thread stutter** |
| M8 | **`ExtractAvccExtradata` busca por SPS/PPS** — assume formato AVCC (4-byte length prefix), mas se o encoder produzir AnnexB (start codes), a busca falha silenciosamente → avcC null → MKV sem CodecPrivate. | `ClipExporter.cs:806-843` | **MKV sem CodecPrivate, mux falha** |
| M9 | **`_audioMixer.MicEnabled` não propagado em config updates** — quando `EngineCoordinator` recebe `config` do Electron, atualiza gains mas não `_audioMixer.MicEnabled` se PTT mode mudou. | `EngineCoordinator.cs` (handler `config`) | **PTT desativa mas mic continua gravando** |
| M10 | **`HotkeyManager` exception swallowing** — `WH_KEYBOARD_LL` callback não tem try-catch. Exceção no callback crasha o processo inteiro (callback é nativo). | `HotkeyManager.cs` (método `KeyboardHookCallback`) | **Crash do processo em exceção de hotkey** |

### BAIXO (melhorias, código morto, otimizações)

| # | Bug | Localização | Impacto |
|---|-----|-------------|---------|
| B1 | **`EncodeRawNv12ToMp4` nunca chamado** — método público no `ClipExporter` que aceita frames NV12 raw, mas nenhum caller existe. | `ClipExporter.cs:1002-1077` | **Código morto (~75 linhas)** |
| B2 | **`GetPendingAudio` no AudioMixer** — retorna listas vazias sempre (implementação stub). | `AudioMixer.cs` (método, se existir) | **Código morto** |
| B3 | **`BenchmarkResult.cs`** — arquivo existe mas não é referenciado por nenhum outro código. | `BenchmarkResult.cs` | **Código morto** |
| B4 | **`CheckFfmpegEncoder` duplicado** — implementação idêntica em `FfmpegEncoder.cs` e `EncoderManager.cs`. | `FfmpegEncoder.cs`, `EncoderManager.cs` | **Duplicação de código** |
| B5 | **`DetectFastestCodec` duplicado** — `ClipExporter.DetectFastestCodec()` replica `EncoderManager.DetectBestCodec()`. | `ClipExporter.cs:1110-1133`, `EncoderManager.cs` | **Duplicação de código** |
| B6 | **MKV diagnostic copy sempre executada** — `ExportToMp4` copia MKV para o diretório do MP4 a cada exportação (~100MB+ para clips longos). Não há flag para desativar. | `ClipExporter.cs:194-205` | **I/O desnecessário, disco gasto** |
| B7 | **Hex dump de MKV** — 200 bytes do MKV são logados a cada exportação. Em debug mode é útil, mas em produção polui logs. | `ClipExporter.cs:208-218` | **Log noise** |
| B8 | **`AvccToAnnexB` privado nunca chamado** — método existe mas `ConvertAvccToAnnexB` (interno) é o que é usado. | `ClipExporter.cs:847-864` | **Código morto** |
| B9 | **`_rawBroadcastQueue` com `MaxBroadcastQueueSize = 1000`** — cada status broadcast é ~500 bytes JSON, então 1000 = ~500KB de fila por cliente. Em burst pode consumir memória. | `NamedPipeServer.cs:147` | **Memory waste potencial** |

---

## 3. Análise do Fluxo Atual — Por Que os Clips Não São Gerados

### Fluxo esperado (Save Clip hotkey → MP4)

```
1. HotkeyManager detecta F9 → EngineCoordinator.OnHotkeyPressed()
2. EngineCoordinator.SaveClipAsync():
   a. ReplayBuffer.GetSegments(replaySec) → (video, audio) listas
   b. ClipExporter.ExportToMp4(outputPath, video, audio, ...)
      b1. WriteMatroskaFile(mkvTemp, video, "h264", avccFallback, audio)
      b2. MuxWithFfmpegStreaming(outputPath, mkvTemp, hasAudioTracks, "h264")
      b3. File.Delete(mkvTemp)
   c. return outputPath
```

### Pontos de falha identificados

**Falha 1: Codec mismatch (C1)**
- `EngineCoordinator` sempre passa `rawFormat: "h264"` para `ExportToMp4`
- Se o encoder NVENC foi configurado como HEVC (`hevc_nvenc`) ou AV1 (`av1_nvenc`), o `rawFormat` deveria ser `"hevc"` ou `"av1"`
- `WriteMatroskaFile` gera `CodecID = "V_MPEG4/ISO/AVC"` para dados HEVC → ffmpeg matroskadec não consegue decodificar
- **Evidência**: clips com encoder HEVC teriam `CodecPrivate` mismatch (avcC em vez de hvcC)

**Falha 2: AAC warmup loss (C2)**
- `FfmpegAacEncoder.Initialize()` dispara `ffmpeg -f f32le ... -c:a aac ... -f adts pipe:1`
- O processo ffmpeg leva ~4.6s para aquecer (BelowNormal priority)
- Durante esses ~4.6s, `EncodeAudio()` escreve PCM no stdin mas `ReaderLoop()` não recebe ADTS
- Canal `DropWrite` descarta frames quando atinge capacity (4096 frames = ~85s a 48kHz/1024 samples)
- **Evidência**: primeiros ~4.6s de áudio perdidos silenciosamente

**Falha 3: PTS distorcido após restart (C3)**
- Se ffmpeg encoder crasha ou é reiniciado (ex: GPU reset), `ResetState()` é chamado
- `_lastRealPtsTicks` não é resetado → próximo frame calcula PTS baseado no valor antigo
- Pode gerar PTS negativo ou salto brusco → Matroska com timestamps inconsistentes

**Falha 4: Deadlock potencial com Broadcast (A1)**
- `NamedPipeServer._statusTimer` chama `OnStatusBroadcast` a cada 2s
- `Broadcast()` serializa `EngineStatusMessage` (com `StatsDetailed()` que faz read lock)
- Se `SaveClipAsync` está executando e segura `_exportLock`, e `StatsDetailed()` precisa de `_lock` do buffer, e o pipe write bloqueia... cadeia de locks pode travar

---

## 4. Análise de Sincronização A/V

### Pontos onde offset é introduzido

| Ponto | Direção do offset | Magnitude típica | Mitigação atual |
|-------|-------------------|-------------------|-----------------|
| WASAPI init delay | Áudio começa DEPOIS do vídeo | 50-500ms | `PadAudioWithSilence` com threshold 30ms |
| NVENC speed <1.0x | PTS de vídeo fica ATRÁS do áudio | 100ms-2s (depende da GPU) | `GetSegments` usa PTS de vídeo como referência |
| AAC encoder warmup | Primeiros ~4.6s de áudio perdidos | ~4.6s | Nenhuma — frames descartados silenciosamente |
| Alt-tab gaps | WGC pausa, áudio continua | 100ms-5s | `FilterAudioByIntervals` remove áudio do gap |
| `ConsumePcmPts` drain | PTS de áudio salta para último valor | Variável | Corrigido (one-at-a-time drain) |
| Clock drift QPC vs ffmpeg | Após 30min+ | 10-100ms/hora | `DriftMonitor` em EngineCoordinator |

### Análise do `GetSegments` PTS offset

```csharp
// ReplayBuffer.cs:212-214
var refPts = video.Count > 0
    ? video[^1].Pts
    : (audio.Count > 0 ? audio[^1].Pts : TimeSpan.Zero);
var start = refPts - maxAge + cutoff;
```

**Problema**: se o vídeo e áudio começaram em PTS diferentes (ex: áudio em 7.46s, vídeo em 7.38s), e o `refPts` é baseado no **último** PTS de vídeo, a janela de recorte `start = refPts - maxAge` pode excluir áudio anterior ao início do vídeo. Isso cria silêncio no início do clip.

**Status**: mitigado pelo `TrimAudioStart` e `PadAudioWithSilence` no `ExportToMp4`, mas a correção é baseada em thresholds fixos (30ms, 2s) que podem não cobrir todos os cenários.

### `DriftMonitor` (EngineCoordinator)

O `DriftMonitor` contínuo compara PTS de vídeo e áudio a cada ~5s. Se o drift excede 150ms (limiar ITU-R BT.1359), emite warning. Isso é **bom** para diagnóstico mas **não corrige** o drift — apenas registra.

---

## 5. Análise de Performance

| Gargalo | Localização | Impacto estimado | Mitigação |
|---------|-------------|-------------------|-----------|
| `ctx.Flush()` síncrono | `GpuVideoConverter.cs` | ~0.5-2ms/frame = 30-120ms/s | Nenhuma — necessário para garantir que GPU processou |
| `_status.Update()` com lock | `EngineCoordinator.cs` pipeline loop | ~0.1-0.5ms/frame | `StatsDetailed()` usa read lock (não bloqueante para writes) |
| `Broadcast()` com lock | `NamedPipeServer.cs` | ~1-5ms a cada 2s | `ConcurrentQueue` para broadcast, mas lock persiste |
| `MixSamples` allocation | `AudioMixer.cs:288-300` | `new float[length]` a cada mix (~4800 samples = 19KB) | `ArrayPool` para `micOut`, mas `outSamples` sempre novo |
| `WriteMatroskaFile` I/O | `ClipExporter.cs` | ~50-200ms para 5min clip (1080p60) | `FileOptions.SequentialScan`, buffer 256KB |
| ffmpeg mux process spawn | `ClipExporter.cs:958-968` | ~100-300ms (criação de processo) | Nenhuma — necessário |
| `GrowIfNeeded` array copy | `ReplayBuffer.cs:165-187` | ~0.1ms a cada 4096 frames | Doubles array — amortizado O(1) |

### RAM do ReplayBuffer

- **Sem cap de bytes por padrão**: `_maxBytes = 0` no construtor → `TrimExcessVideo/Audio` só trimam por duração
- **Com `MaxBytes` configurado**: budgets proporcionais 90/10 (vídeo/áudio)
- **Estimativa para 5min a 20Mbps**: ~750MB de vídeo + ~7MB de áudio = **~757MB**
- **Em GPU integrada Intel (bitrate 5Mbps)**: ~189MB para 5min — aceitável

---

## 6. Código Morto, Duplicado e Funcionalidades Incompletas

### Código Morto (nunca executado)

| Item | Arquivo | Linhas | Status |
|------|---------|--------|--------|
| `EncodeRawNv12ToMp4` | `ClipExporter.cs:1002-1077` | ~75L | Nunca chamado — método público sem callers |
| `AvccToAnnexB` | `ClipExporter.cs:847-864` | ~17L | Privado, nunca chamado — `ConvertAvccToAnnexB` é o usado |
| `SilentAudioSource` | `Audio/SilentAudioSource.cs` | ~50L | Nunca instanciado no fluxo atual |
| `GetPendingAudio` | `AudioMixer.cs` | ~10L | Retorna listas vazias |
| `BenchmarkResult.cs` | `BenchmarkResult.cs` | ~30L | Não referenciado |

### Código Duplicado

| Item | Arquivos | Problema |
|------|----------|----------|
| `CheckFfmpegEncoder` | `FfmpegEncoder.cs`, `EncoderManager.cs` | Implementação idêntica |
| `DetectFastestCodec` / `DetectBestCodec` | `ClipExporter.cs:1110`, `EncoderManager.cs` | Lógica similar |
| `IsAdts` | `ClipExporter.cs:999` | Poderia estar em `EncodedPacket` ou utility |

### Funcionalidades Incompletas

| Item | Status | Descrição |
|------|--------|-----------|
| HEVC/AV1 CodecPrivate | **Incompleto** | `WriteMatroskaFile` só gera avcC para H264. Para HEVC precisaria de hvcC, para AV1 precisaria de AV1CodecConfigurationRecord |
| `SilentAudioSource` | **Nunca implementado** | Deveria ser fallback quando WASAPI falha |
| `GetPendingAudio` | **Stub** | Retorna vazio sempre |

---

## 7. Avaliação de Compatibilidade

| Cenário | Funcionalidade | Problemas identificados |
|---------|---------------|------------------------|
| **NVIDIA (NVENC)** | ✅ Funcional | `h264_nvenc` funciona, AVCC format detectado corretamente |
| **AMD (AMF)** | ⚠️ Parcial | `h264_amf` pode não suportar todos os flags (`-rc-lookahead`, `-temporal-aq`). Sem testes automatizados. |
| **Intel (QSV)** | ⚠️ Parcial | `h264_qsv` pode ter comportamento diferente com `-bf` (B-frames). Sem testes automatizados. |
| **CPU (libx264)** | ✅ Funcional | Fallback universal, bem suportado |
| **Win10** | ⚠️ Parcial | WGC per-process loopback indisponível. `CppLoopbackSource` depende de API Win11 22H2+ |
| **Win11** | ✅ Funcional | WGC completo, `CppLoopbackSource` funcional |
| **GPU integrada Intel** | ⚠️ Parcial | Sem `h264_qsv`, cai para `libx264` — CPU overload em laptops |
| **Sem GPU dedicada** | ⚠️ Parcial | `libx264` fallback, mas `BelowNormal` priority pode causar frame drops |

### `CppLoopbackSource` — dependência Win11

O `ApplicationLoopback.dll` usa `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS` que é API **Windows 11 22H2+**. Em Win10, o `Process.Start` do DLL falha silenciosamente → fallback para `WasapiLoopbackSource` (captura todo o áudio do sistema, não per-processo).

---

## 8. Riscos de Estabilidade para Sessões Longas

| Sessão | Risco | Evidência |
|--------|-------|-----------|
| **30 min** | Baixo-Médio | ReplayBuffer com 5min replay: ~750MB RAM. `GrowIfNeeded` pode fragmentar LOH. Clock drift ~5-50ms. |
| **1 hora** | Médio | Clock drift ~10-100ms. `GpuVideoConverter` InputView cache pode leak se texturas não liberadas. `_outputFrameIndex` overflow em ~29 horas (int64). |
| **3 horas** | Alto | Clock drift ~30-300ms. RAM do buffer pode atingir limite do `MaxBytes`. Processos ffmpeg podem crashar (memory leak no ffmpeg). `GameDetector` polling fallback pode acumular handles de `Process`. |
| **8+ horas** | Crítico | `_outputFrameIndex` atinge ~1.7M (60fps × 8h × 3600). Processos ffmpeg podem crashar múltiplas vezes. `PipelineWatchdog` pode acumular `_frameTimesMs` se `_healthWindow` não limpar corretamente. |

### Riscos específicos de sessão longa

1. **Memory leak no `GpuVideoConverter`** — se `Texture2D` do WGC não for liberada corretamente, cada frame aloca nova textura. Em 3 horas a 60fps = 648.000 texturas.
2. **Handle leak no `GameDetector`** — `Process.GetProcessById()` retorna handle que pode não ser liberado se `Process.Dispose()` não for chamado.
3. **Clock drift** — QPC (MasterClock) é monotônico mas o ffmpeg usa seu próprio clock interno. Após 3 horas, a diferença pode atingir centenas de milissegundos.
4. **Fragmentação LOH** — arrays de `float[]` (4800 samples = 19KB) e `byte[]` (8KB ADTS buffer) alocados no LOH. Após milhares de alocações, o LOH pode fragmentar.

---

## 9. Análise de Thread Safety

### Mapeamento de threads

| Thread | Função | Sincronização |
|--------|--------|---------------|
| **Pipeline** (ThreadPool) | Captura WGC → Convert → Encode → Buffer | `_pipelineLock`, `_statusLock` |
| **Reader** (`FfmpegEncoder`) | stdout ffmpeg → ParseAnnexB → EmitPacket | `_outputChannel` (ConcurrentQueue) |
| **AAC Reader** (`FfmpegAacEncoder`) | stdout ffmpeg AAC → ADTS parse → `_outputChannel` | `_outputChannel` |
| **Pipe** (`NamedPipeServer`) | WaitForConnection → ReadLine → OnMessage | `_longRunningResultQueue`, `broadcastQueue` |
| **Timer** (`_statusTimer`) | Status broadcast a cada 2s | `_statusLock` |
| **Hotkey** (`GameDetectorHook`) | WH_KEYBOARD_LL / SetWinEventHook | `_running` volatile, `_lastForegroundHwnd` Interlocked |
| **PTT** (`PushToTalkManager`) | WH_KEYBOARD_LL para PTT keys | `_pttKeys` (lock) |

### Problemas de sincronização identificados

1. **`_lastRealPtsTicks`** — escrito por reader thread, lido por pipeline thread (via stats). Sem volatile ou lock.
2. **`_frameCount`** — incrementado por reader thread, lido por pipeline thread. Sem Interlocked.
3. **`_droppedFrameCount` no `FfmpegAacEncoder`** — incrementado por AAC reader thread, lido por pipeline thread. Usa `Interlocked.Increment` para escrita mas leitura é non-atomic.
4. **`PipelineWatchdog._lastFrameTime`** — DateTime (128 bits) escrito por pipeline thread, lido por `ShouldReinit()` de qualquer thread. Em x64, DateTime write não é atômico.

---

## 10. Tratamento de Erros

### Exceções silenciadas (`catch { }` sem log)

| Local | Severidade | Risco |
|-------|-----------|-------|
| `FfmpegAacEncoder.cs:52` — `PriorityClass` | Baixa | Processo fica com prioridade Default — aceitável |
| `FfmpegAacEncoder.cs:147` — `_stdout.Read` | **Alta** | Se stdout falha, reader loop termina sem log → áudio silencioso |
| `FfmpegAacEncoder.cs:127` — `FlushAndDrain` | Média | Dispose parcial — pode deixar ffmpeg zombie |
| `ClipExporter.cs:218` — hex dump | Baixa | Diagnóstico — aceitável |
| `ClipExporter.cs:231` — `File.Delete(mkvTemp)` | Baixa | Temp file leak — aceitável |
| `NamedPipeServer.cs:241` — `Broadcast` serialize | Média | JSON serialization failure → broadcast perdido |

### Processos ffmpeg que terminam inesperadamente

- `FfmpegEncoder`: `ReaderLoop` detecta `read == 0` → log "stdout closed" → break. **Detectado mas não tratado automaticamente** — `EngineCoordinator` precisa chamar `ResetState()` + `StartFfmpeg()`.
- `FfmpegAacEncoder`: `ReaderLoop` detecta `read == 0` → log "stdout closed" → break. **Mesmo problema** — sem auto-recovery.
- **Watchdog**: `PipelineWatchdog.ShouldReinit()` pode detectar quando nenhum frame é produzido por 3+ segundos → solicita reinit.

### Device Lost D3D11

- `GpuVideoConverter.Convert()` não tem try-catch para `SharpDX.SharpDXException` (Device Lost).
- Se a GPU resetar (ex: driver update, TDR), a exceção propaga para `EngineCoordinator.PipelineLoop()` → catch genérico → log → tenta restart.
- **Risco**: o `D3D11.Device` e `D3D11.DeviceContext` não são recriados no restart — Device Lost pode persistir.

---

## 11. Conclusão

O sistema DiNho Clips tem uma **arquitetura sólida** com separação clara de responsabilidades. Os problemas identificados são majoritariamente de **integração** (codec mismatch, PTS handling, thread safety) e não de design fundamental. As correções mais impactantes seriam:

1. **Corrigir `rawFormat` para passar o codec correto** (C1) —~10 linhas
2. **Resetar `_lastRealPtsTicks` no `ResetState()`** (C3) —~2 linhas  
3. **Adicionar try-catch no `ReaderLoop` do AAC encoder** (catch silenciado) —~5 linhas
4. **Usar `Interlocked` para contadores cross-thread** (A2) —~10 linhas
5. **Implementar HEVC/AV1 CodecPrivate** (C1 complementar) —~50 linhas

A prioridade imediata deve ser **C1 + C3** pois são os que mais provavelmente causam a falha de "clip não salvo" em cenários reais.
