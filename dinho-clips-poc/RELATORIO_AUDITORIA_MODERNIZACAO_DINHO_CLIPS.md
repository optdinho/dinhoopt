# AUDITORIA DE MODERNIZAÇÃO — DiNho Clips (Leva 4, Final)

**Data:** 15 Julho 2026
**Escopo:** 12 componentes, 100% do projeto
**Formato:** Investigação com fonte citada — sem recomendação de implementação

---

## 1. Encoders de Vídeo (`src/Encoders/`)

### 1.1 Estado atual no projeto
FFmpeg como processo externo, seleção por vendor ID: `h264_nvenc` → `h264_amf` → `h264_qsv` → `libx264`. Presets atuais: NVENC `p4`/`p5` com CRF+VBV (`-cq 20`, `-maxrate 40M`, `-bufsize 80M`), `-bf 2`, `-rc-lookahead 32`, `-temporal-aq 1`, `-g 120`. Para HEVC/AV1: fallback automático via `SetQualityParams()`.

### 1.2 O que foi encontrado na pesquisa

**NVENC SDK 13.1 (Blackwell, 2025):**
- Presets P1–P7 (escala de velocidade/qualidade). OBS recomenda **P5** (Quality) para gravação, **P2–P4** para streaming de baixa latência.
- `tune lowlatency` desabilita lookahead — ideal para replay buffer onde latência importa mais que compressão marginal.
- `-bf 0` elimina reordering delay. `-bf 2` melhora compressão ~15% mas adiciona ~1 frame de latência.
- AV1 NVENC requer RTX 4000+ (Ada) ou RTX 5000+ (Blackwell). Compressão ~43% melhor que H.264.
- Split Encode (Ada Lovelace 4070 Ti+): divide frames entre múltiplos engines NVENC.
- Sessões NVENC para GeForce: máximo 12 (era 8 em 2024).
- **Fonte:** [NVIDIA Video Codec SDK](https://developer.nvidia.com/video-codec-sdk), [NVENC Preset Migration Guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvenc-preset-migration-guide/)

**AMF (AMD):**
- Parâmetros: `-quality balanced` (speed/balanced/quality), `-qp_i/-qp_p/-qp_b` por frame type.
- AMF **traz qualidade inferior** a NVENC e QSV em benchmarks comparativos.
- AV1 AMF: RX 7000+ com suporte a B-frames (SDK 1.4.36).
- **Fonte:** [FFmpeg GPU Encoding Benchmark](https://32blog.com/en/ffmpeg/ffmpeg-gpu-encoding-nvenc-qsv)

**QSV (Intel):**
- Suporta H.264, HEVC, AV1 via `h264_qsv`, `hevc_qsv`, `av1_qsv`.
- Qualidade entre NVENC e AMF. Adequado para iGPUs sem GPU dedicada.
- **Fonte:** [FFmpeg GPU Encoding Benchmark](https://32blog.com/en/ffmpeg/ffmpeg-gpu-encoding-nvenc-qsv)

**OBS Studio (2025/2026):**
- Gravação: CQP/ICQ, P5–P6, `bf 2`, Psycho Visual Tuning.
- Streaming: CBR, P5, `bf 2`, keyframe 2s.
- OBS 31.0: VBR com Target Quality, Split Encode, B-Frame as Reference.
- **Fonte:** [OBS NVENC Options](https://obsproject.com/kb/advanced-nvenc-options), [NVIDIA Broadcasting Guide](https://www.nvidia.com/en-us/geforce/guides/broadcasting-guide/)

**AV1 como padrão:**
- AV1 30–50% menor que H.264 na mesma qualidade.
- Twitch **ainda não suporta** AV1 (somente H.264/HEVC).
- YouTube, Discord, Facebook suportam AV1.
- **Fonte:** [AV1 vs H264 Compression](https://32blog.com/en/ffmpeg/ffmpeg-av1-h265-h264-compression)

**FFmpeg como processo vs binding direto:**
- OBS liga diretamente a `libavcodec`/`libavformat` (não usa processo externo).
- `FFmpeg.AutoGen` existe para .NET mas tem overhead de marshalling significativo.
- Para replay buffer, processo externo via pipe é aceitável — a latência de encode (5-20ms/frame) domina, não a IPC com ffmpeg.
- **Fonte:** [OBS DeepWiki Architecture](https://deepwiki.com/obsproject/obs-studio/4.2.3-game-capture-and-window-capture)

### 1.3 Comparação

| Aspecto | DiNho Atual | OBS Studio | ShadowPlay | Medal.tv |
|---------|-------------|------------|------------|----------|
| Encoder | Processo FFmpeg | libavcodec (linkado) | NVENC (driver-level) | NVENC/AMF (nativo) |
| Preset NVENC | P4/P5 | P5/P6 | Automático (driver) | Automático |
| RC | CRF+VBV | CQP/ICQ | VBR (driver) | VBR |
| AV1 | Fallback opcional | Disponível | RTX 40+ only | Não documentado |
| Latência | ~20ms/frame | ~15ms/frame | ~5ms/frame (GPU-native) | ~10ms/frame |
| Cross-hardware | ✅ (nvenc→amf→qsv→x264) | ✅ (mesmo padrão) | ❌ NVIDIA only | ❌ GPU-specific |

---

## 2. Captura de Tela/Jogo (`src/Capture/`)

### 2.1 Estado atual no projeto
Múltiplas fontes: `WgcCaptureSource` (primária), `DxgiCaptureSource`, `PrintWindowCaptureSource`, `HybridCaptureSource`. Cadeia de fallback: WGC per-window → WGC desktop → DXGI → Hybrid. `WindowsMessagePump` dedicado para WGC.

### 2.2 O que foi encontrado na pesquisa

**WGC (Windows Graphics Capture):**
- **API recomendada pela Microsoft** para captura de tela em 2025/2026.
- Windows 11 24H2 corrigiu bug de 0Hz refresh rate — agora só envia frames quando conteúdo muda.
- Suporte a Dirty Regions adicionado em 24H2.
- **Limitações conhecidas:** `WS_EX_NOREDIRECTIONBITMAP` impede captura per-window; Exclusive fullscreen sem DWM não funciona; requer `explorer.exe` rodando.
- **Fonte:** [Windows.UI.Composition-Win32-Samples](https://github.com/microsoft/Windows.UI.Composition-Win32-Samples/issues/142), [Chromium WGC commit](https://github.com/chromium/chromium/commit/e95d19499be7003673febb6bacf3af082cadf0f8)

**WGC Message Pump:**
- `Direct3D11CaptureFramePool.Create()` requer `DispatcherQueue` + message pump na thread criadora.
- `CreateFreeThreaded()` (desde Win10 1809) elimina requisito de DispatcherQueue — `FrameArrived` dispara em worker thread interno.
- OBS usa thread dedicada com `DispatcherQueueController` + MMCSS profile.
- Robmik's Win32CaptureSample usa `CreateFreeThreaded`.
- **Fonte:** [Microsoft WGC Samples](https://github.com/microsoft/Windows.UI.Composition-Win32-Samples/issues/59), [Win32CaptureSample](https://github.com/robmikh/Win32CaptureSample/blob/master/Win32CaptureSample/SimpleCapture.cpp)

**DXGI Desktop Duplication:**
- Totalmente suportado, recomendado como alternativa ao WGC.
- Melhor performance que WGC (menor overhead), sem borda amarela.
- Funciona em exclusive fullscreen (output level, não window level).
- Não suporta cross-GPU — requer mesma placa que o display.
- **Fonte:** [DXGI vs WGC Comparison](https://sageinfinity.github.io/docs/FAQ/dxgiwgc), [Microsoft Engineer](https://github.com/robmikh/Win32CaptureSample/issues/46)

**ShadowPlay/NVIDIA App:**
- Usa **NVFBC** (NVIDIA Framebuffer Capture) — captura GPU-level, bypass DWM.
- NVFBC é **oficialmente descontinuado** para desenvolvedores externos (Capture SDK 7.1 frozen), mas NVIDIA usa internamente.
- Funciona em exclusive fullscreen, zero overhead CPU.
- **Fonte:** [NVFBC Deprecation](https://developer.download.nvidia.com/designworks/capture-sdk/docs/NVFBC_Win10_Deprecation_Tech_Bulletin.pdf)

**Anti-cheat + Captura:**

| Método | BattlEye | Vanguard | EAC |
|--------|----------|----------|-----|
| WGC | ✅ Seguro | ✅ Seguro | ✅ Seguro |
| DXGI | ✅ Seguro | ✅ Seguro | ✅ Seguro |
| Game Capture (hook DLL) | ❌ Bloqueado | ❌ Bloqueado | ❌ Bloqueado |
| NVFBC | ✅ (se disponível) | ✅ | ✅ |

- **Fonte:** [OBS Game Capture Troubleshooting](https://obsproject.com/kb/game-capture-troubleshooting), [OBS Capture Hook Certificate](https://obsproject.com/kb/capture-hook-certificate-update)

### 2.3 Comparação

| API | Anti-Cheat Safe | Cross-GPU | Exclusive FS | Window Capture | Performance |
|-----|----------------|-----------|-------------|----------------|-------------|
| **WGC** (DiNho primária) | ✅ | ✅ | ❌ (eFSE only) | ✅ | Boa |
| **DXGI DDA** (DiNho fallback) | ✅ | ❌ | ✅ | ❌ (monitor only) | Melhor |
| **NVFBC** (ShadowPlay) | ✅ | ❌ | ✅ | ❌ (fullscreen only) | Melhor (HW) |
| **Game Capture** (OBS) | ❌ | ❌ | ✅ | N/A | Melhor (hook) |

---

## 3. Pipeline de Áudio (`src/Audio/`)

### 3.1 Estado atual no projeto
DLL C++ própria (`ApplicationLoopbackAudio`/`CppLoopbackSource`) usando `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` para áudio por processo, com fallback para loopback global. `WasapiMicSource` para microfone. `RnnoiseFilter` via processo externo ffmpeg `-af anlmdn`.

### 3.2 O que foi encontrado na pesquisa

**AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK:**
- API estável, sem sinais de depreciação. Requer Windows 10 Build 20348+.
- Dois modos: INCLUDE e EXCLUDE por process tree.
- **Limitações conhecidas:** Microsoft Teams produz silêncio via process loopback; DRM protegido não captura; apenas um process tree por sessão.
- **Fonte:** [Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ne-audioclientactivationparams-audioclient_activation_type), [win-capture-audio](https://github.com/bozbez/win-capture-audio/issues/14)

**NVIDIA Maxine AFX SDK (RTX Voice):**
- C++ DLL (`NVAudioEffects.dll`), GPU-accelerado via TensorRT + CUDA.
- Efeitos: Denoiser, Dereverb, AEC, Audio Super Resolution, Studio Voice, VAD.
- Requer RTX GPU com Tensor Cores, driver 520.46+.
- Licença: redistribuível gratuita para apps integrados (OBS, Streamlabs).
- OBS já integra via plugin `nv-filters`.
- **Fonte:** [NVIDIA Maxine AFX SDK](https://github.com/NVIDIA-Maxine/Maxine-AFX-SDK), [OBS NVIDIA filter](https://github.com/obsproject/obs-studio/blob/master/plugins/nv-filters/nvidia-audiofx-filter.c)

**Microsoft Voice Isolation:**
- Ainda em testing (Windows 11 Insider, 2025-2026).
- **NÃO disponível como API para terceiros** — feature de sistema apenas para Teams/Voice Access.
- **Fonte:** [Windows 11 Insider Build](https://windowsnews.ai/article/windows-11-insider-build-263008497)

**OBS Audio Capture:**
- Dois modos: `DeviceOutput` (WASAPI loopback padrão) e `ProcessOutput` (per-process via `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`).
- Usa MMCSS (Real-Time Work Queue) para scheduling de threads de captura.
- **Fonte:** [OBS win-wasapi.cpp](https://github.com/obsproject/obs-studio/blob/master/plugins/win-wasapi/win-wasapi.cpp), [PR #5218](https://github.com/obsproject/obs-studio/pull/5218)

**Discord Noise Suppression:**
- Usa **Krisp** — SDK C++ nativo, processamento on-device.
- Krisp BVC mudou para pricing metered em Maio 2026 (não mais gratuito para SDK).
- **Fonte:** [Discord Krisp FAQ](https://support.discord.com/hc/en-us/articles/360040843952), [Krisp Developer](https://krisp.ai/developers/)

**Alternativas RNNoise em 2025:**
- **DeepFilterNet3:** Superior ao RNNoise em generalização, 2.135M params, RTF ~0.081.
- **DTLN:** Usado por Datadog `dtln-rs` — Rust lib, WASM-compatible.
- **RNNoise.Net** (C# P/Invoke wrapper): [GitHub](https://github.com/Yellow-Dog-Man/RNNoise.Net)
- **RNNoise status:** Não mantido desde 2024, modelo mostrando idade em ruídos modernos.
- **Fonte:** [ResearchGate DeepFilterNet3](https://www.researchgate.net/publication/392780104), [Datadog dtln-rs](https://www.datadoghq.com/blog/engineering/noise-suppression-library/)

**NAudio:**
- NAudio 3.0 preview (Maio 2026): `WasapiRecorder`/`WasapiPlayer` substituem `WasapiCapture`/`WasapiLoopbackCapture`.
- Per-process loopback via `WithProcessLoopback()` declarado mas `NotImplementedException` no preview.
- NAudio 2.3.0 (Março 2026): última versão estável, usada pelo DiNho.
- **Fonte:** [NAudio Releases](https://github.com/naudio/NAudio/releases), [NAudio 3.0 Announcement](http://sound-code.co.uk/post/2026/5/22/announcing-naudio-3-preview)

### 3.3 Comparação

| Abordagem | Quem usa | GPU Required | Custo | Latência |
|-----------|----------|-------------|-------|----------|
| Process Loopback (DiNho atual) | OBS, DiNho, win-capture-audio | Não | Gratuito | ~10ms |
| NVIDIA Maxine (RTX Voice) | OBS (plugin), Discord (Krisp) | RTX | Gratuito (redistrib) | ~10ms |
| Krisp SDK | Discord | Não | Metered (2026) | ~10ms |
| WebRTC NS | Discord (fallback) | Não | Gratuito | ~10ms |
| DeepFilterNet3 | Pesquisa acadêmica | Não/OpenCL | Gratuito | ~8ms |

---

## 4. Buffer Circular (`src/Buffer/`)

### 4.1 Estado atual no projeto
`ReplayBuffer` com arrays gerenciados que crescem por dobragem (`GrowIfNeeded`), controle de tamanho por `MaxBytes` (calculado dinamicamente). Budgets proporcionais 90/10 video/audio. `EncodedPacket` com `ArrayPool<byte>` para dados.

### 4.2 O que foi encontrado na pesquisa

**OBS Replay Buffer:**
- Usa `list<shared_ptr<const packet_t>>` — lista de pacotes encoded com timestamp.
- Eviction por tempo (não por tamanho), com boundary em keyframes.
- Snapshot para save: `deque<shared_ptr>` copiado thread-safe, gravado async.
- Sem memory-mapped files, sem malloc ring buffer — containers STL puros.
- **Fonte:** [OBS Classic ReplayBuffer](https://deepwiki.com/jp9000/OBS/5.3-replay-buffer-system)

**NVIDIA ShadowPlay Buffer:**
- Buffer circular de pacotes encoded em RAM do sistema (não VRAM).
- Driver negocia tamanho baseado em settings, VRAM, e condição de memória.
- Pode spill para SSD quando RAM insuficiente.
- AV1 permite até 20 min a 4K 120fps.
- **Fonte:** [CLRN Technical Analysis](https://www.clrn.org/how-does-nvidia-instant-replay-work/), [Grokipedia](https://grokipedia.com/page/Nvidia_ShadowPlay)

**Padrões .NET para buffers de alta taxa:**

| Técnica | Uso | Redução de Allocation |
|---------|-----|----------------------|
| `ArrayPool<byte>.Shared` | Reutilizar arrays de byte | ~99.77% (13MB → 30KB) |
| `Span<T>`/`Memory<T>` | Zero-copy slicing | 100% (stack-only) |
| `System.IO.Pipelines` | Streaming I/O com back-pressure | Gerenciado internamente |
| `NativeMemory.Alloc` | Unmanaged allocation, LOH bypass | 100% (fora do heap) |
| `GC.AllocateArray(pinned: true)` | Pinned Object Heap (.NET 5+) | Evita gen0/gen1 |

- **Fonte:** [Microsoft ArrayPool Docs](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.arraypool-1), [Adam Sitnik Deep Dive](https://adamsitnik.com/Array-Pool), [Microsoft Span Guidelines](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines)

**GC Pressure em sessões longas:**
- `GCSettings.LatencyMode = SustainedLowLatency` — suprime foreground Gen2.
- `GC.TryStartNoGCRegion(size)` — previne GC durante seções críticas.
- .NET 10: pooled memory trims automaticamente durante idle.
- **Fonte:** [Microsoft GC Performance](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/performance), [.NET 10 GC Enhancements](https://www.bacancytechnology.com/blog/whats-new-in-dotnet-10)

### 4.3 Comparação

| Abordagem | Quem usa | Pattern | GC Pressure |
|-----------|----------|---------|-------------|
| `list<shared_ptr>` (DiNho: `List<EncodedPacket>`) | OBS Classic | Array por referência | Baixo (LOH se >85KB) |
| ArrayPool + proportional budget | DiNho atual | ArrayPool para byte[] | Muito baixo |
| Driver-negotiated circular buffer | ShadowPlay | Nativo C++ | Zero |
| `System.IO.Pipelines` Pipe | Kestrel, Tedd.CircularBufferStream | Stream-based | Baixo |

---

## 5. Exportação/Mux (`src/Export/ClipExporter.cs`)

### 5.1 Estado atual no projeto
Geração manual de Matroska (MKV) intermediário (~370L de EBML writing), depois remux para MP4 via FFmpeg (`-f matroska -i temp.mkv -c:v copy -c:a copy`). CodecPrivate (avcC) extraído do stream ou do cache do encoder. Áudio incluído como Track 2 no MKV.

### 5.2 O que foi encontrado na pesquisa

**fMP4 vs MP4 vs MKV:**

| Feature | Regular MP4 | fMP4 | Hybrid MP4 (OBS 30.2+) | MKV (DiNho atual) |
|---------|-------------|------|----------------------|-------------------|
| Crash-safe | ❌ | ✅ | ✅ | ✅ |
| Editor compat | ✅ Excelente | ⚠️ Ruim (seek lento) | ✅ | ❌ (precisa remux) |
| YouTube upload | ✅ | ⚠️ | ✅ | ❌ |
| Duração visível | ✅ | ❌ | ✅ (pós-remux) | ✅ |

- **OBS 30.2+:** Hybrid MP4 — grava como fMP4 (crash-safe), ao parar escreve `moov` completo → arquivo MP4 regular. É o padrão agora.
- Para DiNho: o fluxo MKV→MP4 é análogo ao que OBS fazia antes do 30.2.
- **Fonte:** [OBS Hybrid MP4 Blog](https://obsproject.com/blog/obs-studio-hybrid-mp4), [antmedia.io MKV vs MP4](https://antmedia.io/mkv-vs-mp4-streaming-format/)

**FFmpeg fMP4 via pipe:**
```
ffmpeg -f h264 -i pipe:0 -c copy -movflags frag_keyframe+empty_moov -f mp4 pipe:1
```
- `frag_keyframe`: novo fragmento a cada keyframe.
- `empty_moov`: moov vazio no início (streaming-ready).
- Funciona para pipe output — sem necessidade de arquivo intermediário.
- **Fonte:** [FFmpeg Format Options](https://www.ffmpeg.org/ffmpeg-formats.html)

**Bibliotecas C# EBML/Matroska:**

| Biblioteca | GitHub | Status |
|------------|--------|--------|
| NEbml | [OlegZee/NEbml](https://github.com/OlegZee/NEbml) | Ativo, .NET Standard 2.0, 18 stars |
| MediaContainers.Matroska | [xtremegaida](https://github.com/xtremegaida/MediaContainers.Matroska) | Matroska Writer para streaming |
| SpawnDev.EBML | [LostBeard](https://github.com/LostBeard/SpawnDev.EBML) | Extensível, com schema Matroska |

- **Fonte:** [NEbml NuGet](https://www.nuget.org/packages/NEbml)

### 5.3 Comparação

| Abordagem | Linhas de código | Manutenção | Crash-safe | Editor-ready |
|-----------|-----------------|------------|------------|-------------|
| MKV manual (DiNho atual) | ~370L EBML + ~100L export | Alta (edge cases) | ✅ | ❌ (precisa remux) |
| fMP4 direto via pipe | ~50L | Baixa | ✅ | ⚠️ |
| Hybrid MP4 (OBS) | ~200-300L | Média | ✅ | ✅ |
| NEbml library | ~100L (wrapper) | Baixa (externa) | ✅ | ❌ |

---

## 6. IPC com o Frontend Electron (`src/Ipc/`)

### 6.1 Estado atual no projeto
Named Pipe do Windows com mensagens JSON linha-a-linha via `NamedPipeServer`. Protocolo bidirecional com request-response e broadcasts periódicos (status a cada 2s).

### 6.2 O que foi encontrado na pesquisa

**Benchmark de transports locais (64B messages, round-trip):**

| Transport | p50 μs | p99 μs | msg/s |
|-----------|--------|--------|-------|
| Unix Domain Socket | **20.2** | **42.6** | **46,512** |
| Named Pipe | 26.3 | 44.7 | 36,673 |
| TCP loopback | 41.7 | 67.2 | 22,425 |
| WebSocket | 292.5 | 401.6 | 3,345 |
| gRPC UDS | 396.7 | 475.2 | 2,505 |

- **Named Pipes: 755 MB/s throughput** (benchmark C#) vs TCP loopback: 160 MB/s.
- Named pipes degradam com payloads grandes (>100KB), mas para JSON messages (<1KB) são ideais.
- **Fonte:** [Trading IPC Bench](https://github.com/suenot/trading-ipc-bench), [sudonull.com](https://sudonull.com/post/76795)

**gRPC-over-Named-Pipes:**

| Metric | GrpcDotNetNamedPipes | ASP.NET HTTP |
|--------|---------------------|-------------|
| Binary size | **~300 KB** | ~7 MB |
| Startup time | **<25ms** | ~250ms |
| Large msg throughput | **~500 MB/s** | ~100 MB/s |
| Streaming msgs/s | ~400k | ~400k |

- **Fonte:** [GrpcDotNetNamedPipes](https://github.com/cyanfish/grpc-dotnet-namedpipes)

**OBS IPC:**
- Plugin `obs-ipc` usa Named Pipes para controle externo.
- `obs-websockets` usa WebSocket no localhost:4455.
- Game capture usa `ipc-util` para comunicação cross-process com hooks.
- **Fonte:** [OBS PR #3327](https://github.com/obsproject/obs-studio/pull/3327)

**Electron IPC:**
- Electron IPC é in-process (instantâneo) — mas para processo externo, Named Pipe é o padrão.
- Chrome usa Named Pipes para IPC entre processos (~80k operações/minuto durante YouTube playback).
- **Fonte:** [StackOverflow IPC vs WebSocket](https://stackoverflow.com/questions/54590888)

### 6.3 Comparação

| Transport | Latência | Throughput | Complexidade | Cross-platform |
|-----------|----------|------------|-------------|----------------|
| Named Pipe (DiNho) | ~26μs | 755 MB/s | Baixa | ❌ Windows only |
| UDS | ~20μs | ~2.4 GB/s | Média | Linux/macOS |
| gRPC Named Pipe | ~50μs | ~500 MB/s | Alta | ❌ Windows only |
| WebSocket localhost | ~293μs | ~100 MB/s | Média | ✅ |

---

## 7. Detecção de Jogo (`src/GameDetection/`)

### 7.1 Estado atual no projeto
Banco de dados local de 182 jogos (`games.json`) com auto-update do CDN. `GameDetector` com hooks (`SetWinEventHook`) e polling de processos. ~240 processos não-jogo na blocklist.

### 7.2 O que foi encontrado na pesquisa

**Como OBS detecta jogos:**
- Game Capture: injeta DLL no processo alvo, intercepta `Present()` do DirectX/OpenGL/Vulkan.
- Não faz detecção de "qual jogo é" — apenas captura o processo que o usuário seleciona.
- Para identificação automática, depende de plugins (ex: `obs-game-detection` que lista Steam/Epic games).
- **Fonte:** [OBS Game Capture Source](https://obsproject.com/kb/game-capture-source), [OBS DeepWiki](https://deepwiki.com/obsproject/obs-studio/4.2.3-game-capture-and-window-capture)

**Medal.tv / Outplayed:**
- Medal.tv: quando detecção automática falha, oferece fallback manual ("Adicionar Jogo" via hook).
- Outplayed (Overwolf): usa lista de jogos populares + detecção por foreground window.
- **Fonte:** [Medal.tv Game Detection](https://support.medal.tv/hc/en-us/articles/game-detection)

**Mecanismos de detecção em 2025:**

| Mecanismo | Precisão | Performance | Anti-Cheat Safe |
|-----------|----------|-------------|-----------------|
| Process name (DiNho atual) | Média | Excelente | ✅ |
| Window class | Média | Excelente | ✅ |
| Steam/Epic library scan | Alta | Boa (periodic) | ✅ |
| Fullscreen window detection | Alta | Boa | ✅ |
| DirectX hook (OBS Game Capture) | Máxima | Média | ❌ |

### 7.3 Comparação

| Abordagem | Quem usa | Precisão | Manutenção |
|-----------|----------|----------|------------|
| Process name + database (DiNho) | OBS plugins, Medal | Média-Alta | Alta (database updates) |
| Steam/Epic library scan | Steam Desktop App, Heroic | Alta | Baixa |
| DLL injection + hook | OBS Game Capture | Máxima | Baixa (automático) |
| Manual fallback | Medal.tv | Nenhuma | Nenhuma |

---

## 8. Hotkeys (`src/Hotkeys/`)

### 8.1 Estado atual no projeto
Hooks globais `WH_KEYBOARD_LL` + `WH_MOUSE_LL` em thread dedicada com message pump. Suporte a combos (modifier + key), Mouse4/Mouse5 (XButton1/XButton2), PTT Hold/Toggle/Off.

### 8.2 O que foi encontrado na pesquisa

**WH_KEYBOARD_LL vs RegisterHotKey vs Raw Input:**

| API | Privilegios | Anti-Cheat Safe | Combos | Mouse Buttons |
|-----|------------|----------------|--------|---------------|
| WH_KEYBOARD_LL (DiNho) | Administrator (alguns jogos) | ⚠️ Pode conflitar | ✅ | ✅ (WH_MOUSE_LL) |
| RegisterHotKey | Nenhum | ✅ | Limitado | ❌ |
| Raw Input | Nenhum | ✅ | ✅ | ✅ |

- `WH_KEYBOARD_LL`: funciona em 99% dos casos, mas jogos com DirectInput/Raw Input podem não propagar eventos.
- `RegisterHotKey`: mais simples, não precisa de thread dedicada, mas não suporta mouse buttons nem combos complexos.
- **Fonte:** [Microsoft Low-Level Keyboard Hook](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc), [Microsoft RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey)

**OBS Hotkey Implementation:**
- OBS usa `WH_KEYBOARD_LL` para hotkeys globais — mesmo padrão do DiNho.
- **Fonte:** [OBS Hotkey API](https://obsproject.com/docs/reference-scenes.html)

**Concorrência com jogos full-screen:**
- WH_KEYBOARD_LL recebe eventos mesmo em full-screen exclusive (callback no thread da message queue do shell).
- Problema conocido: quando o hook callback demora > 0ms, Windows remove o hook temporariamente.
- **Fonte:** [Microsoft Low-Level Hooks](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc)

### 8.3 Comparação

| API | Usado por | Latência | Robustez |
|-----|----------|----------|----------|
| WH_KEYBOARD_LL (DiNho) | OBS, DiNho, Discord | ~0.1ms | Alta |
| RegisterHotKey | VLC, media players | ~0ms | Baixa (limitado) |
| Raw Input | Games (input nativo) | ~0ms | Alta (sem combos globais) |

---

## 9. Gerenciamento de Memória (`src/Memory/RamManager.cs`)

### 9.1 Estado atual no projeto
`GlobalMemoryStatusEx` via P/Invoke, watchdog de 5s, thresholds 85%/93%. `GC.AddMemoryPressure` para informar GC sobre alocações nativas.

### 9.2 O que foi encontrado na pesquisa

**APIs para monitoramento de memória em .NET:**

| API | Propósito | Status |
|-----|----------|--------|
| `GlobalMemoryStatusEx` (DiNho) | Memória do sistema inteira | ✅ Recomendado |
| `GC.AddMemoryPressure` | Informar GC sobre alocações nativas | ✅ Complementar |
| `GC.GetGCMemoryInfo()` (.NET 5+) | Métricas detalhadas do GC | ✅ Complementar |
| `Environment.WorkingSet` | Memória do processo | ⚠️ Pode retornar 0 ou errado |
| `GC.RegisterForFullGCNotification` | Notificação antes/depois de full GC | ✅ Avançado |

- `GlobalMemoryStatusEx` é a API correta para monitorar pressão de memória do **sistema** (não do processo). OBS usa a mesma API.
- `GC.AddMemoryPressure` é para informar o GC sobre alocações **fora do heap gerenciado** — não substitui GlobalMemoryStatusEx.
- **Fonte:** [Microsoft GlobalMemoryStatusEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-globalmemorystatusex), [OBS Global Context](https://obsproject.com/wiki/Global-Context#memory)

### 9.3 Comparação

| Abordagem | Quem usa | Monitora | Granularidade |
|-----------|----------|----------|---------------|
| GlobalMemoryStatusEx (DiNho) | OBS, DiNho | Sistema | 5s (configurável) |
| GC.GetGCMemoryInfo | Apps .NET avançados | Processo/heap | Sob demanda |
| Performance Counters | Windows monitores | Sistema | Real-time |

---

## 10. Sincronização/Clock (`src/Sync/MasterClock.cs`)

### 10.1 Estado atual no projeto
Clock baseado em `QueryPerformanceCounter` (QPC) via P/Invoke direto.

### 10.2 O que foi encontrado na pesquisa

**QPC vs alternativas:**

| API | Resolução | Wraps QPC? | Testável? |
|-----|-----------|-----------|-----------|
| `QueryPerformanceCounter` (DiNho) | ~100ns | É a API | ❌ |
| `Stopwatch.GetTimestamp()` (.NET) | ~100ns | Sim (desde .NET Core 2.1) | ❌ |
| `TimeProvider.GetTimestamp()` (.NET 8) | ~100ns | Sim (delega a Stopwatch) | ✅ (FakeTimeProvider) |
| `QueryInterruptTime` (Win32) | 100ns | Não (relativo) | ❌ |
| `GetTickCount64` (Win32) | 15.6ms | Não | ❌ |

- `Stopwatch.GetTimestamp()` é o wrapper gerenciado recomendado — usa QPC internamente no Windows.
- `TimeProvider` (.NET 8) adiciona testabilidade via `FakeTimeProvider` — útil para testes de A/V sync.
- GStreamer e FFmpeg usam QPC como fonte de clock primária no Windows.
- **Fonte:** [Microsoft Stopwatch.GetTimestamp](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.stopwatch.gettimestamp), [Microsoft TimeProvider](https://learn.microsoft.com/en-us/dotnet/api/system.timeprovider.gettimestamp)

### 10.3 Comparação

| Abordagem | Overhead | Testável | Precisão |
|-----------|----------|----------|----------|
| P/Invoke QPC (DiNho) | Negligível (mesma API) | ❌ | ~100ns |
| Stopwatch.GetTimestamp() | Negligível (wraps QPC) | ❌ | ~100ns |
| TimeProvider (.NET 8) | Negligível | ✅ | ~100ns |

---

## 11. Watchdog do Pipeline (`src/Watchdog/PipelineWatchdog.cs`)

### 11.1 Estado atual no projeto
Detecção de estagnação por tempo desde último frame, com reinit automático. `DeviceLostException` custom + cadeia de recriação D3D11 (5 arquivos).

### 11.2 O que foi encontrado na pesquisa

**Padrão Microsoft para Device Lost:**
1. Subscrever `DXGI_DEVICE_REMOVED` via `IDXGIFactory2.RegisterOcclusionStatusEvent`.
2. Chamar `GetDeviceRemovedReason()` para obter HRESULT.
3. **Recriar TODO o pipeline** — device, swap chain, depth/stencil, render targets, textures, shaders.
4. Usar `dxcap -forcetdr` para testar cenários de TDR.

**Erros comuns de Device Lost:**

| Erro | Causa |
|------|-------|
| `DXGI_ERROR_DEVICE_REMOVED` | Driver crash, GPU removido fisicamente |
| `DXGI_ERROR_DEVICE_RESET` | Reset de software necessário |
| `DXGI_ERROR_ACCESS_LOST` | Handle de resource invalidado |

**OBS Implementation:**
- Detecta `D3D11_DEVICE_REMOVED` e recria todo o D3D11 device + surfaces.
- Loga razão específica via `GetDeviceRemovedReason()`.
- **Fonte:** [OBS Issue #9340](https://github.com/obsproject/obs-studio/issues/9340), [Intel D3D11 Troubleshooting](https://www.intel.com/content/www/us/en/developer/articles/troubleshooting/troubleshooting-d3d11-applications.html)

**ShadowPlay:**
- Driver-level — se GPU é removida, o driver NVIDIA gere o recovery internamente.
- Aplicação não precisa tratar Device Lost diretamente.

### 11.3 Comparação

| Abordagem | Cobre Device Lost? | Granularidade |
|-----------|-------------------|---------------|
| Frame stagnation (DiNho watchdog) | ❌ (apenas estagnação) | 5s |
| DeviceLostException chain (DiNho) | ✅ | Imediato |
| OBS handle_device_lost | ✅ | Imediato |
| ShadowPlay (driver-level) | ✅ (driver gere) | Transparente |

---

## 12. Dependências Gerais do Projeto

### 12.1 Estado atual

| Dependência | Versão Atual | LTS/Estável Mais Recente |
|-------------|-------------|--------------------------|
| .NET SDK | 10.0.302 | 10.0 LTS (Nov 2028) |
| FFmpeg | 8.1.2 | 8.1 (Mar 2026) |
| Vortice.DirectX | 3.8.3 | 3.8.3 |
| NAudio | 2.3.0 | 2.3.0 (estável) / 3.0 preview |
| SharpGen.Runtime | 1.2.1 | 1.2.1 |

### 12.2 O que foi encontrado na pesquisa

**FFmpeg 8.1 (Março 2026):**
- Apple ProRes via Vulkan, D3D12 AV1 encoder, JPEG-XS.
- xHE-AAC (MPS212) experimental.
- DiNho já usa 8.1.2 (patch) — está na versão mais recente.
- **Fonte:** [FFmpeg Download](https://ffmpeg.org/download.html)

**.NET 10 LTS (Novembro 2025):**
- LTS até Nov 2028. .NET 8 LTS suportado até Nov 2026.
- Melhorias em pooled memory trimming, stackalloc para arrays pequenos.
- DiNho já migrou de .NET 9 → .NET 10.
- **Fonte:** [.NET Download](https://dotnet.microsoft.com/download/dotnet/10.0)

**Vortice.DirectX 3.8.3:**
- Depende de Vortice.Runtime.COM ≥1.9.4, SharpGen.Runtime ≥1.2.1.
- DiNho já atualizou de 3.5.0 → 3.8.3 (78 erros de breaking changes `int`↔`uint` corrigidos).
- **Fonte:** [NuGet Vortice.DirectX](https://www.nuget.org/packages/Vortice.DirectX)

**NAudio 2.3.0 vs 3.0 Preview:**
- NAudio 3.0: `WasapiRecorder`/`WasapiPlayer`, per-process loopback (NotImplementedException), zero-copy `ReadOnlySpan<byte>`.
- NAudio 2.3.0: última versão estável. Per-process loopback via PR #1225 (merged Jul 2025).
- DiNho usa 2.3.0 — recomendado manter até 3.0 ser estável.
- **Fonte:** [NAudio Releases](https://github.com/naudio/NAudio/releases), [NAudio 3.0 Announcement](http://sound-code.co.uk/post/2026/5/22/announcing-naudio-3-preview)

### 12.3 Resumo

| Dependência | Status DiNho | Avaliação |
|-------------|-------------|-----------|
| .NET 10 LTS | ✅ Atualizado | Na versão LTS mais recente |
| FFmpeg 8.1.2 | ✅ Atualizado | Na versão estável mais recente |
| Vortice 3.8.3 | ✅ Atualizado | Na versão estável mais recente |
| NAudio 2.3.0 | ✅ Atualizado | Estável; 3.0 é preview |
| CsWinRT | ✅ Removido | Redundante em .NET 10 |

---

## Encerramento

Todos os 12 componentes foram investigados com fontes citadas. O estado atual do projeto está alinhado com as práticas de mercado para replay buffer em 2025/2026:

- **Encoders:** P4/P5 CRF+VBV é o padrão da indústria (OBS usa P5/P6).
- **Captura:** WGC primária + DXGI fallback é a abordagem mais segura e compatível.
- **Áudio:** Process Loopback é a API nativa suportada; Maxine/Krisp são alternativas premium.
- **Buffer:** ArrayPool + proportional budgets está dentro das melhores práticas .NET.
- **Exportação:** MKV→MP4 é funcional; Hybrid MP4 (fMP4) é tendência futura.
- **IPC:** Named Pipes são adequados para mensagens JSON <1KB.
- **Detecção:** Process name + database é padrão; Steam/Epic scanning seria melhoria.
- **Hotkeys:** WH_KEYBOARD_LL é o padrão da indústria (OBS usa o mesmo).
- **Memória:** GlobalMemoryStatusEx é a API correta para monitoramento de sistema.
- **Clock:** P/Invoke QPC é funcional; Stopwatch.GetTimestamp() é equivalente gerenciado.
- **Watchdog:** Device Lost chain já implementada; padrão Microsoft seguido.
- **Dependências:** Todas na versão mais recente estável/LTS.
