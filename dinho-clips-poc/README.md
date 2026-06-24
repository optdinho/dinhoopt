# DiNho Clips — POC Fase 0 (Captura) + Fase 1 (Engine)

Prova de conceito: captura (DXGI + WGC), encoder H264 via ffmpeg, replay buffer, áudio WASAPI.

## Pré-requisitos

- Windows 10 1903+ ou Windows 11
- GPU NVIDIA/AMD/Intel (NVENC/AMF/QSV via ffmpeg)
- [ffmpeg](https://ffmpeg.org) no PATH
- .NET 9 SDK

## Como compilar e rodar

```powershell
.\build.ps1
.\run-poc.ps1
```

> Use `-c Release` — Debug distorce latência.

## Comandos

| Comando | Descrição |
|---------|-----------|
| (sem args) | Engine modo contínuo |
| `--encoders` | Lista e testa encoders disponíveis |
| `--bench` | Benchmark captura + encode |
| `--test` | Testes rápidos de componentes |
| `--force-software` | Força libx264 (CPU) em vez de NVENC |

## Pipeline atual

```
DXGI / WGC → GPU Texture → GpuVideoConverter (NV12) → ffmpeg stdin → H.264 → ReplayBuffer
                                                                               ↓
                                                                         Export: ffmpeg remux → MP4 (H264 + AAC)
```

Encoder: **ffmpeg subprocess** com NVENC (hw) ou libx264 (sw).
GPU→GPU NV12 via D3D11 Video Processor — sem uso de CPU no hot path.
Export: remux via ffmpeg `-c copy` (sem re-encode) + AAC a 128kbps.
