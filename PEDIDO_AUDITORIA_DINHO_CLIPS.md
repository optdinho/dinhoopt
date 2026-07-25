# PEDIDO DE AUDITORIA COMPLETA — DiNho Clips
## Sistema de Gravação em Buffer (Replay Buffer)

---

## Contexto do Projeto

DiNho Clips é um software de replay buffer para Windows desenvolvido em C#/.NET 9. O usuário joga, o sistema grava continuamente em segundo plano, e quando o usuário pressiona um botão o sistema salva os últimos N segundos como um arquivo de vídeo MP4.

O sistema precisa funcionar em qualquer hardware — NVIDIA, AMD e Intel — e em Windows 10 e Windows 11, em notebooks e desktops, com GPU dedicada e GPU integrada. O encode de vídeo usa seleção automática de encoder com fallback na ordem h264_nvenc (NVIDIA) → h264_amf (AMD) → h264_qsv (Intel) → libx264 (CPU, fallback universal).

O sistema é composto pelos seguintes módulos:

- **Captura de vídeo**: Windows Graphics Capture (WGC), DXGI Desktop Duplication, e HybridCaptureSource (DXGI + PrintWindow para jogos em background). `WgcCaptureSource.cs`, `DxgiCaptureSource.cs`, `HybridCaptureSource.cs`
- **Conversão de cor GPU**: BGRA→NV12 via D3D11 VideoProcessor. `GpuVideoConverter.cs`
- **Encode de vídeo**: processo ffmpeg externo com seleção automática de encoder por hardware, alimentado via stdin, lido via stdout em H.264/HEVC/AV1 Annex B. `FfmpegEncoder.cs`, `EncoderManager.cs`
- **Captura de áudio do sistema**: WASAPI loopback completo (`WasapiLoopbackSource.cs`) ou per-processo via C++ DLL (`CppLoopbackSource.cs`, `ApplicationLoopback.dll`)
- **Captura de microfone**: WASAPI com suporte a PTT Hold e PTT Toggle. `WasapiMicSource.cs`
- **Mixagem de áudio**: combina loopback e microfone em stream PCM único, com noise suppression opcional via ffmpeg arnndn/anlmdn. `AudioMixer.cs`, `RnnoiseFilter.cs`
- **Encode de áudio**: segundo processo ffmpeg externo usando AAC, alimentado via stdin, lido via stdout em ADTS. `FfmpegAacEncoder.cs`
- **Ring buffer circular**: armazena EncodedPackets de vídeo e áudio encodados com trim por duração. `ReplayBuffer.cs`
- **Exportação**: extrai segmentos do buffer, gera arquivo Matroska temporário com vídeo, mux via terceiro processo ffmpeg com áudio em arquivo MP4 final. `ClipExporter.cs`
- **Sincronização**: clock monotônico via QPC (Stopwatch). PTS de áudio rastreados via fila PCM→AAC. `MasterClock.cs`
- **Coordenação geral**: orquestra todos os módulos, gerencia pipeline loop a ~60fps, watchdog de saúde, reinit automático. `EngineCoordinator.cs`
- **Comunicação com frontend Electron**: named pipe com protocolo JSON envelope. `NamedPipeServer.cs`, `IpcMessageHandler.cs`
- **Detecção de jogos**: detecta processo em foreground e modo de exibição. `GameDetector.cs`
- **Hotkeys**: hook global WH_KEYBOARD_LL e WH_MOUSE_LL. `HotkeyManager.cs`, `PushToTalkManager.cs`
- **Watchdog**: monitora saúde do pipeline por frames dropped. `PipelineWatchdog.cs`

---

## O que Preciso

Quero que você realize uma **auditoria técnica completa, profunda e imparcial** em todo o sistema. Não assuma que nenhuma parte está correta. Analise 100% do fluxo de ponta a ponta.

O sistema atualmente **não está gerando clips**. Clips não são salvos. A gravação para sem aviso. Esse é o problema principal, mas quero que você audite tudo — incluindo problemas que ainda não se manifestaram.

---

## Objetivos da Auditoria

A auditoria deve investigar e reportar sobre os seguintes pontos sem exceção:

**Bugs e Falhas**
- Bugs existentes que impedem o funcionamento
- Fluxos incompletos ou parcialmente implementados
- Falhas silenciosas sem log ou tratamento
- Condições de corrida (race conditions)
- Deadlocks e potenciais deadlocks
- Starvation de threads
- Código que nunca é executado (código morto)
- Recursos alocados mas nunca liberados (vazamentos de memória, handles, streams, processos)

**Thread Safety**
- Acessos a campos compartilhados sem sincronização adequada
- Locks insuficientes ou excessivos
- Uso incorreto de CancellationToken
- Problemas com threads de captura, encode, pipe e watchdog rodando simultaneamente

**Pipeline de Vídeo**
- Fluxo de entrada: WGC/DXGI → textura BGRA → GpuVideoConverter → NV12 → stdin ffmpeg
- Fluxo de saída: stdout ffmpeg → ParseAnnexB → EmitPacket → ReplayBuffer
- Comportamento do parser H.264 Annex B com NALUs grandes (keyframes >512KB)
- Race condition entre enqueue de PTS (pipeline thread) e dequeue no EmitPacket (reader thread)
- Comportamento do `_outputChannel` quando cheio (DropOldest)
- Restart automático do ffmpeg: ResetState, StartFfmpeg, ReaderLoop recriado corretamente?
- Prioridade do processo ffmpeg vs processo do jogo em foreground
- Parâmetros de encode: compatibilidade entre `-spatial-aq`, `-temporal-aq`, `-rc-lookahead`, `-bf` com replay buffer em tempo real
- Compatibilidade dos parâmetros para h264_nvenc, h264_amf, h264_qsv e libx264 (cada codec tem diferentes flags suportadas)
- GpuVideoConverter: cache de InputView com textura diferente por frame (WGC entrega nova textura por frame)
- ctx.Flush() após CopyResource: impacto no jitter de timing
- DetectBestCodec: cache estático pode retornar codec errado após mudança de GPU ou reinit
- SilentAudioSource nunca emite dados — AudioMixer fica bloqueado no loopback queue?

**Pipeline de Áudio**
- Fluxo: WASAPI/CppLoopback → AudioMixer → PCM float[] → stdin ffmpeg AAC → ADTS → ReplayBuffer
- TryMix: drena toda a fila de mic de uma vez vs uma janela de loopback — alinhamento temporal correto?
- Mix: micSamples pode ter comprimento diferente de loopbackSamples — índice micIdx tratado corretamente?
- CppLoopbackSource: callback de áudio nativo para código gerenciado — GCHandle alocado corretamente? Thread-safe?
- CppLoopbackSource: converte PCM int16 para float mas entrega como 2 canais — mono vs stereo correto?
- RnnoiseFilter: stdin.Write + stdout.Read síncronos no mesmo thread — pode bloquear indefinidamente?
- WasapiMicSource: formato forçado para mono (channels=1) mas AudioMixer pode esperar stereo
- FfmpegAacEncoder: buffer ADTS de 8192 bytes — suficiente para frames grandes?
- Prioridade BelowNormal do processo ffmpeg AAC
- _pcmBuf no FfmpegAacEncoder: realocação frequente?

**Sincronização A/V**
- PTS de vídeo: enqueue antes de Write() no stdin — se ffmpeg emite dois frames rapidamente, o segundo pode pegar o PTS do primeiro
- PTS de áudio: _outputFrameIndex no FfmpegAacEncoder usado como PTS base, depois sobrescrito por ConsumePcmPts() — race condition?
- ConsumePcmPts: fila _pcmPtsQueue consumida corretamente com partial consume (re-enqueue)?
- GetSegments: video[0].Pts e audio[0].Pts podem ter offset inicial causando gap no arquivo MP4
- Clock drift entre MasterClock (QPC) e clock interno do ffmpeg após sessões longas
- queueRemaining estável em 9 no log — fila PCM não está sendo consumida na proporção esperada?

**ReplayBuffer**
- GrowIfNeeded dobra o array: pode alocar o dobro do necessário temporariamente
- TrimExcessVideo e TrimExcessAudio: trimam apenas por duração, não por bytes — sem cap de RAM
- CopyRing no GetSegments: cópia profunda de dados poolados — seguro com AddVideo/AddAudio rodando concorrentemente?
- Pacotes com IsPooled=true: Release() no trim — double-free possível se CopyRing copiou a referência?
- _totalVideoDuration e _totalAudioBytes: contabilidade consistente com os pacotes reais?

**Exportação**
- WriteMatroskaFile: clusters com unknown-size — ffmpeg consegue desmuxar corretamente?
- ExtractAvccExtradata: SPS/PPS extraídos do stream Annex B — correto para todos os encoders?
- FilterAudioByIntervals: pode remover áudio válido se os intervalos de vídeo tiverem gaps
- PadAudioWithSilence: frames AAC silenciosos gerados manualmente — header ADTS correto para todos os sample rates?
- MuxWithFfmpegStreaming: stdin fechado antes de WaitForExit — pode causar broken pipe?
- GetSegments sem re-base de PTS — arquivo final começa em t=42s em vez de t=0s
- rawFormat passado como "h264" fixo em SaveClipAsync independente do codec real usado

**Frontend ↔ Backend**
- Protocolo named pipe: envelope v1 com cmd/payload — todas as mensagens do Electron mapeadas?
- Broadcast de status: fila por cliente (`broadcastQueue`) — cliente lento pode perder broadcasts?
- NamedPipeServer com maxNumberOfServerInstances=1 — segunda conexão recusada silenciosamente?
- Mensagens IPC que reiniciam a pipeline (`setAudioSessions`, `config`) — TryScheduleRestart é thread-safe?
- `Broadcast()` chamado de dentro do pipeline loop — pode causar contenção?

**Compatibilidade**
- Funcionamento em Windows 10 vs Windows 11 (WGC per-process loopback disponível apenas em Win11)
- Funcionamento com GPU integrada Intel sem suporte a h264_qsv
- Funcionamento com GPU AMD sem AMF
- Funcionamento sem GPU dedicada (libx264 fallback)
- CppLoopbackSource (ApplicationLoopback.dll): dependência de API disponível apenas em Windows 11 22H2+?

**Performance e Consumo de Hardware**
- CPU: ffmpeg rodando em BelowNormal com jogo em foreground — impacto no throughput
- GPU: ctx.Flush() síncrono a cada frame — stall no pipeline thread
- RAM: sem cap de bytes no ReplayBuffer — crescimento ilimitado com bitrates altos
- Alocações frequentes no caminho crítico: `new float[]` em Mix(), `new byte[]` no FfmpegAacEncoder
- _status.Update() chamado todo frame com StatsDetailed() que faz lock no buffer
- LOH: arrays grandes alocados com frequência — fragmentação e pressão no GC

**Tratamento de Erros**
- Exceções silenciadas com `catch { }` sem log em pontos críticos
- Processos ffmpeg que terminam inesperadamente — detectado e tratado?
- Device lost D3D11 — caminho de recuperação completo e testado?
- StopCapture chamado de dentro do pipeline loop — deadlock com _pipelineLock?
- Pipeline reiniciando com encoder ou capture nulos

**Código Morto e Duplicações**
- `SilentAudioSource` — nunca instanciado no fluxo atual?
- `EncodeRawNv12ToMp4` no ClipExporter — nunca chamado?
- `GetPendingAudio` no AudioMixer — retorna listas vazias sempre?
- `BenchmarkResult.cs` — utilizado?
- `CheckFfmpegEncoder` duplicado em FfmpegEncoder e EncoderManager
- `DetectFastestCodec` no ClipExporter duplica EncoderManager.DetectBestCodec
- `IsSystemWindowClass` e `IsSystemExecutablePath` no EngineCoordinator — utilizados em todos os casos necessários?

---

## Relatório Esperado

Ao término da auditoria, quero um relatório completo contendo:

1. **Resumo executivo** com os principais problemas encontrados e sua causa raiz
2. **Lista de bugs**, classificados por severidade: Crítico / Alto / Médio / Baixo, com justificativa técnica para cada
3. **Análise do fluxo atual** descrevendo onde exatamente o sistema falha e por quê os clips não estão sendo gerados
4. **Análise de sincronização A/V** descrevendo todos os pontos onde o offset entre áudio e vídeo pode ser introduzido
5. **Análise de performance** com os gargalos identificados e o impacto estimado de cada um
6. **Código morto, duplicado e funcionalidades incompletas** com localização exata
7. **Avaliação de compatibilidade** por fabricante de GPU e versão do Windows
8. **Riscos de estabilidade** para sessões longas (30 min, 1h, 3h)

Para cada problema encontrado: descreva o que está errado, onde está no código (arquivo e trecho específico), e qual o impacto. Não precisa fornecer correções — apenas o diagnóstico completo e preciso.

---

## Arquivos do Projeto

```
src/DiNho.Capture.Poc/EngineCoordinator.cs
src/DiNho.Capture.Poc/IpcMessageHandler.cs
src/DiNho.Capture.Poc/Encoders/FfmpegEncoder.cs
src/DiNho.Capture.Poc/Encoders/FfmpegAacEncoder.cs
src/DiNho.Capture.Poc/Encoders/GpuVideoConverter.cs
src/DiNho.Capture.Poc/Encoders/EncoderManager.cs
src/DiNho.Capture.Poc/Encoders/EncodedPacket.cs
src/DiNho.Capture.Poc/Encoders/IEncoder.cs
src/DiNho.Capture.Poc/Audio/AudioMixer.cs
src/DiNho.Capture.Poc/Audio/WasapiMicSource.cs
src/DiNho.Capture.Poc/Audio/WasapiLoopbackSource.cs
src/DiNho.Capture.Poc/Audio/CppLoopbackSource.cs
src/DiNho.Capture.Poc/Audio/AudioSessionManager.cs
src/DiNho.Capture.Poc/Audio/RnnoiseFilter.cs
src/DiNho.Capture.Poc/Audio/SilentAudioSource.cs
src/DiNho.Capture.Poc/Audio/IAudioSource.cs
src/DiNho.Capture.Poc/Buffer/ReplayBuffer.cs
src/DiNho.Capture.Poc/Export/ClipExporter.cs
src/DiNho.Capture.Poc/Sync/MasterClock.cs
src/DiNho.Capture.Poc/Capture/WgcCaptureSource.cs
src/DiNho.Capture.Poc/Capture/DxgiCaptureSource.cs
src/DiNho.Capture.Poc/Capture/HybridCaptureSource.cs
src/DiNho.Capture.Poc/Capture/ICaptureSource.cs
src/DiNho.Capture.Poc/Ipc/NamedPipeServer.cs
src/DiNho.Capture.Poc/Hotkeys/HotkeyManager.cs
src/DiNho.Capture.Poc/Hotkeys/PushToTalkManager.cs
src/DiNho.Capture.Poc/Watchdog/PipelineWatchdog.cs
src/DiNho.Capture.Poc/Config/ConfigManager.cs
src/DiNho.Capture.Poc/Status/EngineStatus.cs
src/DiNho.Capture.Poc/GameDetection/GameDetector.cs
src/DiNho.Capture.Poc/Program.cs
```
