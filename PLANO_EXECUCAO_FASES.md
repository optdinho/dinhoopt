# PLANO DE EXECUÇÃO — Correção dos 55 Problemas do DiNho Clips

## Estratégia

- **8 fases** ordenadas por dependência e severidade
- Cada fase é auto-contida: correção → code review via agente → build + testes
- Cada fase termina com `dotnet build` e `dotnet test` Verdes
- Fases 1-3 = pipeline trava/nao produz clips (bloqueantes)
- Fases 4-6 = qualidade/drivers/edge cases
- Fase 7-8 = export/polish

---

## FASE 1 — Capture Pipeline (DxgiCaptureSource + WGC + PipelineLoop)

**Objetivo:** Eliminar os 2 bugs Críticos que impedem DXGI de funcionar + proteger PipelineLoop

**Issues:** C1, C2, H3, L3, L14

**Arquivos:** `DxgiCaptureSource.cs`, `WgcCaptureSource.cs`, `GpuVideoConverter.cs`, `EngineCoordinator.cs`

| ID | Arquivo | O que fazer |
|----|---------|-------------|
| C1 | `DxgiCaptureSource.cs:99-103,111` | Remover `using var` do `output1` que é guardado como `selectedOutput`. Usar AddRef manual ou copiar referência sem `using` |
| C2 | `DxgiCaptureSource.cs:141-143,184-187` | Adicionar null-check em `desktopResource?.Dispose()` no finally |
| H3 | `EngineCoordinator.cs:1005-1008` | Envolver `cap.TryCaptureFrame(captureTimeout)` dentro do try-catch. Em exceção: log + retornar frame vazio |
| L3 | `WgcCaptureSource.cs:335,176-183` | Setar `_frameSignal = null` após `Dispose()` + guardar `WaitOne` com try-catch |
| L14 | `GpuVideoConverter.cs:115-118` | Já seguro na ordem atual. Apenas verificar/comentar |

**Agentes:**
1. Agente **general** para ler e corrigir todos os 4 arquivos
2. Agente **code-reviewer** para revisar as correções
3. `dotnet build` + `dotnet test`

---

## FASE 2 — Engine Coordinator Thread Safety (EngineCoordinator + IpcMessageHandler)

**Objetivo:** Eliminar race conditions do coordenador principal + handlers IPC

**Issues:** C3, H8, H9, H14, H15, L8, L11

**Arquivos:** `EngineCoordinator.cs`, `IpcMessageHandler.cs`

| ID | Arquivo | O que fazer |
|----|---------|-------------|
| C3 | `EngineCoordinator.cs:1190-1273` | Envolver `ReinitializePipelineAsync` com `lock (_pipelineLock)`. Garantir que `StopCapture()` + `StartCapture()` sejam atômicos |
| H8 | `IpcMessageHandler.cs:252` | Usar `Interlocked` ou lock ao ler `_recording` |
| H9 | `IpcMessageHandler.cs:410-429` | Garantir que `_audioMixer` nunca fique null com `_recording=true`. Criar mixer antes de setar flag |
| H14 | `EngineCoordinator.cs:1363` | Trocar `catch { }` por `catch { Log.W(...) }` com log do PID |
| H15 | `EngineCoordinator.cs:775` | Mover `Thread.Sleep(400ms)` para fora do `_pipelineLock` (release lock antes de dormir) |
| L8 | `EngineCoordinator.cs:1181` | Remover `SwitchCaptureApi()` morta |
| L11 | `EngineCoordinator.cs:1544-1631` | Remover duplicatas + corrigir " Narrator" → "Narrator" |

**Agentes:**
1. Agente **general** para correções
2. Agente **code-reviewer** (atenção especial a locks)
3. `dotnet build` + `dotnet test`

---

## FASE 3 — Watchdog + Config + Game Detection (arquivos pequenos)

**Objetivo:** Watchdog funcional, config persistente, detecção de jogo correta

**Issues:** C4, C9, H10, H11, H12, H13, M15, M16

**Arquivos:** `PipelineWatchdog.cs`, `ConfigManager.cs`, `GameDatabaseUpdater.cs`, `GameDatabase.cs`, `GameDetector.cs`, `NamedPipeServer.cs`

| ID | Arquivo | O que fazer |
|----|---------|-------------|
| C4 | `PipelineWatchdog.cs:57` | Mudar de `_frameTimesMs` (apenas valores) para `Queue<(double elapsed, double duration)>` com timestamps. Filtrar por `elapsed - _healthWindow` |
| C9 | `ConfigManager.cs:166` | Usar `JsonSerializerOptions { PropertyNameCaseInsensitive = true }` no `Load()` |
| H10 | `GameDatabaseUpdater.cs:66,78,90,97,106,118` | Só salvar `LastCheckUnixMs` em caso de SUCESSO. Em falha: manter timestamp anterior |
| H11 | `GameDatabase.cs:45,73` | Adicionar `volatile bool _loaded` ou lock no `Load()` |
| H12 | `GameDetector.cs:215-218` | Disparar `OnGameChanged` também para HWND nulo no `PollForeground` |
| H13 | `GameDatabaseUpdater.cs:113` | Usar temp file + `File.Move` atômico (ou `File.Replace`) |
| M15 | `GameDetector.cs:73` | Adicionar `volatile` em `CurrentGame` |
| M16 | `NamedPipeServer.cs:146` | Limitar `_rawBroadcastQueue` (ex: max 1000 mensagens) |

**Agentes:**
1. Agente **general** para correções
2. Agente **code-reviewer**
3. `dotnet build` + `dotnet test`

---

## FASE 4 — Audio Pipeline (AudioMixer + WASAPI + CppLoopback + AAC)

**Objetivo:** Estabilizar pipeline de áudio, eliminar distorção e crashes

**Issues:** H4, H5, M4, M5, M6, M7, M8, M9, L5, L6, L7

**Arquivos:** `AudioMixer.cs`, `WasapiMicSource.cs`, `WasapiLoopbackSource.cs`, `CppLoopbackSource.cs`, `AudioSessionMuteManager.cs`, `FfmpegAacEncoder.cs`, `SilentAudioSource.cs`

| ID | Arquivo | O que fazer |
|----|---------|-------------|
| H4 | `AudioMixer.cs:263-268` | Substituir `SoftClip()` por função monotônica (tanh ou cubic soft-clip monotônico) |
| H5 | `AudioSessionMuteManager.cs:28` | Acumular incrementalmente em vez de `_saved.Clear()`. Ou restaurar tudo antes de reaplicar |
| M4 | `CppLoopbackSource.cs:112` | Usar buffer reutilizável (array pool) + `Buffer.MemoryCopy` em vez de `new float[]` |
| M5 | `CppLoopbackSource.cs:153,182` | Só liberar GCHandle após garantir que DLL parou de chamar callback (sinalizar + join no pump thread) |
| M6 | `WasapiMicSource.cs:38-43` | Mover `_running = true` para DEPOIS de `StartRecording()`. Adicionar try-catch |
| M7 | `WasapiLoopbackSource.cs:28-54` | Mesmo padrão + capturar exceção de formato inválido |
| M8 | `AudioMixer.cs:91-94` | Inicializar `_sampleRate` e `_channels` com defaults (48000, 2) no construtor, ANTES de `Start()` |
| M9 | `FfmpegAacEncoder.cs:109-125` | Usar lock ou flag para impedir `EncodeAudio()` concorrente com `FlushAndDrain` |
| L5 | `AudioMixer.cs:290-293` | Remover `GetPendingAudio()` |
| L6 | `SilentAudioSource.cs` | Remover arquivo (dead code) |
| L7 | `FfmpegAacEncoder.cs:78-79` | Trimar `_pcmBuf` se ficou muito maior que o necessário |

**Agentes:**
1. Agente **general** para correções
2. Agente **code-reviewer**
3. `dotnet build` + `dotnet test`

---

## FASE 5 — RnnoiseFilter (Deadlock)

**Objetivo:** Eliminar deadlock que trava pipeline de áudio inteira

**Issues:** C7, C8

**Arquivo:** `RnnoiseFilter.cs`

| ID | Arquivo | O que fazer |
|----|---------|-------------|
| C7 | `RnnoiseFilter.cs:69-75` | Substituir `_stdout.Read()` síncrono por `ReadAsync()` com timeout (ex: 5s). Se timeout: log + descartar frame + continuar |
| C8 | `RnnoiseFilter.cs:41` | Adicionar `proc.BeginErrorReadLine()` + event handler (pode ser vazio, só para drenar pipe) |
| - | `RnnoiseFilter.cs:84` | Corrigir lógica de leftover (condição `_readOffset > totalRead` nunca é verdade) |

**Agentes:**
1. Agente **general** para correção
2. Agente **code-reviewer** (segurança thread)
3. `dotnet build` + `dotnet test`

---

## FASE 6 — FfmpegEncoder (Encoder de Vídeo)

**Objetivo:** Corrigir parser de NAL units, bitstream filters, races e leaks

**Issues:** H1, H2, M1, M2, M3, L1, L2, L4

**Arquivo:** `FfmpegEncoder.cs`

| ID | Arquivo | O que fazer |
|----|---------|-------------|
| H1 | `FfmpegEncoder.cs:256-261,276` | AV1: remover `av1_mp4toannexb` (não existe). Usar raw pipe sem bsf ou converter manualmente. Documentar limitação |
| H2 | `FfmpegEncoder.cs:507,579-591,618-631` | Detectar codec real e usar parsing correto: H264 → 1-byte NAL header (`& 0x1F`), HEVC → 2-byte (`(>> 1) & 0x3F`). AV1 → OBU parser diferente ou skip |
| M1 | `FfmpegEncoder.cs:677-684` | Adicionar `Volatile.Read` ou usar variáveis locais para log diagnóstico |
| M2 | `FfmpegEncoder.cs:19-23,665-670` | Logar warning quando pacotes são dropados do `_outputChannel` |
| M3 | `FfmpegEncoder.cs:465-475,787-791` | Liberar `_rawBuf` em `ResetState()` |
| L1 | `FfmpegEncoder.cs:428-436` | Adicionar limite máximo para `_rawBuf` (ex: 64MB) com descarte + log |
| L2 | `FfmpegEncoder.cs:951-979` | Só reiniciar ffmpeg no `Flush()` se `_isRunning` |
| L4 | `FfmpegEncoder.cs:310-311,768` | Capturar `ObjectDisposedException` no stderr thread loop |

**Agentes:**
1. Agente **general** para correções
2. Agente **code-reviewer** (atenção ao parser H264/HEVC)
3. `dotnet build` + `dotnet test`

---

## FASE 7 — ReplayBuffer + ClipExporter (Exportação)

**Objetivo:** MP4 reproduzível em qualquer player + sem áudio cortado

**Issues:** C5, C6, H6, H7, M10, M11, M12, M13, M14, L9, L10

**Arquivos:** `ReplayBuffer.cs`, `ClipExporter.cs`

| ID | Arquivo | O que fazer |
|----|---------|-------------|
| C5 | `ClipExporter.cs:30` + `EngineCoordinator.cs:1494` | Propagar `rawFormat` real do encoder (não hardcoded "h264"). `EngineCoordinator` passa `_encoder?.Codec ?? "h264"` |
| C6 | `ReplayBuffer.cs:134-163` + `ClipExporter.cs:464-490` | Re-baselinear PTS em `GetSegments()`: subtrair `video[0].Pts` de todos os pacotes. Mesmo para áudio |
| H6 | `ClipExporter.cs:841-842` | Adicionar event handler vazio em `ErrorDataReceived` (só para drenar pipe) |
| H7 | `ClipExporter.cs:658-669` | Não dispor stdin; usar `stdin.Flush()` + fechar stream de escrita do pipe (não o objeto). Ou esperar `WaitForExit` antes de dispor |
| M10 | `ReplayBuffer.cs:84,96-108` | Adicionar `_maxAudioBytes` (~50MB para 5min AAC) + trim de áudio por bytes também |
| M11 | `ReplayBuffer.cs:1125-1131` | Usar `Stats()` apenas (que já retorna tudo) ou lock único para ambas chamadas |
| M12 | `ClipExporter.cs:371` | Mudar `flags |= 0x01` para `flags &= 0xFE` (bit 0 = reserved, manter 0) |
| M13 | `ClipExporter.cs:135-175` | Opcional: gerar ADTS com raw_data_block válido (frame AAC silencioso real) |
| M14 | `ClipExporter.cs:119-120` | Propagar erro de thumbnail para o Electron (via callback ou status) |
| L9 | `ClipExporter.cs:749-880` | Remover `EncodeRawNv12ToMp4()` + `DetectFastestCodec()` |
| L10 | `ClipExporter.cs:702-703` | Usar `ArrayPool<byte>.Shared` em vez de `new byte[]` |

**Agentes:**
1. Agente **general** para correções
2. Agente **code-reviewer**
3. `dotnet build` + `dotnet test`

---

## FASE 8 — Logging + Polish + Build Final

**Objetivo:** Finalizar todas as correções e garantir build verde

**Issues:** L12, L13, L15 + verificação geral

**Arquivos:** `Log.cs`, `ConsoleLogger.cs`, `Interop.cs`

| ID | Arquivo | O que fazer |
|----|---------|-------------|
| L12 | `Log.cs:22-24` | Adicionar guarda `if (value == null) throw ...` ou ignorar silenciosamente |
| L13 | `ConsoleLogger.cs:31` | Opcional: logar falha de I/O em `Debug.WriteLine` (não `catch { }` vazio) |
| L15 | `Interop.cs:226-234` | Usar `hMonitor` (IntPtr) diretamente em vez de `GetHashCode()` |

**Final:**
- `dotnet build` — 0 erros
- `dotnet test` — 100% passando (149+)
- `dotnet publish -c Release --self-contained true -r win-x64`
- `npm run copy-engine`
- Revisão final do AGENTS.md

---

## Fluxo de Execução por Fase

```
┌─────────────────────────────────────────────────┐
│  Para cada fase:                                │
│                                                  │
│  1. Agente #1 (general)                         │
│     → Lê o código fonte                         │
│     → Implementa as correções da fase           │
│     → Retorna diff / resumo do que mudou        │
│                                                  │
│  2. Agente #2 (code-reviewer)                   │
│     → Revisa as mudanças da fase                │
│     → Aponta problemas, sugere melhorias        │
│                                                  │
│  3. Bash: dotnet build                          │
│     Se falhar: volta pro passo 1                │
│                                                  │
│  4. Bash: dotnet test                           │
│     Se falhar: volta pro passo 1                │
│                                                  │
│  5. Avança para próxima fase                    │
└─────────────────────────────────────────────────┘
```

## Resumo

| Fase | Issues | Arquivos | Severidade mais alta |
|------|--------|----------|---------------------|
| 1 — Capture Pipeline | C1, C2, H3, L3, L14 | 4 | 🔴 2 Críticos |
| 2 — Engine Coordinator | C3, H8, H9, H14, H15, L8, L11 | 2 | 🔴 1 Crítico |
| 3 — Watchdog + Config | C4, C9, H10-H13, M15, M16 | 6 | 🔴 2 Críticos |
| 4 — Audio Pipeline | H4, H5, M4-M9, L5-L7 | 7 | 🟠 2 Altos |
| 5 — RnnoiseFilter | C7, C8 | 1 | 🔴 2 Críticos |
| 6 — FfmpegEncoder | H1, H2, M1-M3, L1, L2, L4 | 1 | 🟠 2 Altos |
| 7 — ReplayBuffer + Export | C5, C6, H6, H7, M10-M14, L9, L10 | 2 | 🔴 2 Críticos |
| 8 — Logging + Polish | L12, L13, L15 | 3 | 🟢 Baixos |

**Total: 8 fases, 55 issues, ~20 arquivos modificados**
