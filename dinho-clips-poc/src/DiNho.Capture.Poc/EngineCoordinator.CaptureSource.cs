using DiNho.Capture.Poc.Capture;
using DiNho.Capture.Poc.Logging;
using System.Runtime.InteropServices;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    private void SelectCaptureSource()
    {
        var game = _captureTargetGame;
        var gameHwnd = game.IsValid ? game.Hwnd : IntPtr.Zero;

        // Salva o HWND original para usar como fallback em reinit
        // (quando o jogo está minimizado, MainWindowHandle pode ser Zero)
        if (gameHwnd != IntPtr.Zero)
            _captureTargetHwnd = gameHwnd;

        // WDA check — jogos que usam WDA_EXCLUDEFROMCAPTURE não podem ser capturados via WGC per-window
        if (game.IsValid && gameHwnd != IntPtr.Zero && WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            Log.I("EngineCoordinator", $"Jogo '{game.ProcessName}' usa WDA_EXCLUDEFROMCAPTURE — pulando WGC per-window, usando desktop/Hybrid");
        }

        // 1) WGC per-window (melhor qualidade) — tenta até 3x com 400ms entre tentativas
        if (game.IsValid && gameHwnd != IntPtr.Zero && IsWindowValidForWgc(gameHwnd)
            && !WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            const int maxRetries = 3;
            const int retryDelayMs = 400;

            // Ensure we have a dedicated STA thread with message pump for WGC.
            // WGC FrameArrived needs a message pump for DWM to deliver frames.
            _wgcPump ??= new WindowsMessagePump();

            for (var attempt = 1; attempt <= maxRetries; attempt++)
                {
                    // Capture device reference locally — StopCapture() may dispose it during retry delay
                    var device = _sharedDevice;
                    if (device == null || !_captureActive)
                    {
                        Log.W("EngineCoordinator", $"WGC retry aborted: device={device != null} active={_captureActive}");
                        break;
                    }
                    WgcCaptureSource? wgc = null;
                    try
                    {
                        wgc = new WgcCaptureSource();
                        // Marshal Initialize + StartFramePump to the pump thread.
                        // This ensures the WGC capture session is created on an STA thread
                        // with a message pump, which is required for FrameArrived to fire.
                        _wgcPump.Invoke(() =>
                        {
                            wgc.Initialize(device, gameHwnd);
                            wgc.StartFramePump();
                        });
                        _capture = wgc;
                        _status.Update(s => s.CaptureBackend = $"WGC:{game.ProcessName}");
                        Log.I("EngineCoordinator", $"Captura: janela '{game.ProcessName}' ({gameHwnd})");
                        goto multiMonitor;
                    }
                    catch (Exception ex) when (attempt < maxRetries)
                    {
                        wgc.Dispose();
                        var innerMsg = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
                        Log.E("EngineCoordinator", $"WGC window tentativa {attempt}/{maxRetries} falhou: {ex.Message}{innerMsg}, retry em {retryDelayMs}ms...");
                        // Release lock during delay to avoid starving StopCapture, but re-check device on resume
                        bool heldLock = Monitor.IsEntered(_pipelineLock);
                        if (heldLock) Monitor.Exit(_pipelineLock);
                        try { Thread.Sleep(retryDelayMs); }
                        finally { if (heldLock) Monitor.Enter(_pipelineLock); }
                    }
                    catch (Exception ex)
                    {
                        wgc.Dispose();
                        var innerMsg = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
                        Log.E("EngineCoordinator", $"WGC window tentativa {maxRetries}/{maxRetries} falhou: {ex.Message}{innerMsg}, fallback...");
                    }
                }
        }

        // 2) WGC desktop (full monitor via DWM) — funciona para qualquer janela
        //    No multi-monitor, captura o monitor onde o jogo está
        try
        {
            var gameMonitor = gameHwnd != IntPtr.Zero
                ? MonitorHelper.GetMonitorFromWindowHandle(gameHwnd)
                : IntPtr.Zero;

            _wgcPump ??= new WindowsMessagePump();

            var wgc = new WgcCaptureSource();
            _wgcPump.Invoke(() =>
            {
                wgc.Initialize(_sharedDevice, IntPtr.Zero, gameMonitor);
                wgc.StartFramePump();
            });
            _capture = wgc;
            _status.Update(s => s.CaptureBackend = "WGC");
            Log.I("EngineCoordinator", "Captura: Windows Graphics Capture (desktop)");
            goto multiMonitor;
        }
        catch (Exception wgcEx)
        {
            var innerMsg = wgcEx.InnerException != null ? $" → {wgcEx.InnerException.GetType().Name}: {wgcEx.InnerException.Message}" : "";
            Log.E("EngineCoordinator", $"WGC desktop falhou: {wgcEx.GetType().Name}: {wgcEx.Message}{innerMsg}");
        }

        // 3) DXGI Desktop Duplication (full monitor, funciona sempre)
        try
        {
            var dxgi = new DxgiCaptureSource();
            dxgi.Initialize(_sharedDevice, gameHwnd);
            _capture = dxgi;
            _status.Update(s => s.CaptureBackend = "DXGI");
            Log.I("EngineCoordinator", "Captura: DXGI Desktop Duplication");
            goto multiMonitor;
        }
        catch (Exception dxgiEx)
        {
            Log.E("EngineCoordinator", $"DXGI falhou: {dxgiEx.GetType().Name}: {dxgiEx.Message}");
        }

        // 4) Hybrid (DXGI + PrintWindow) — fallback para janela em background
        try
        {
            var hybrid = new HybridCaptureSource();
            hybrid.Initialize(_sharedDevice, gameHwnd);
            _capture = hybrid;
            _status.Update(s => s.CaptureBackend = _capture.Name);
            Log.I("EngineCoordinator", $"Captura híbrida: HWND=0x{gameHwnd:X8}");
            goto multiMonitor;
        }
        catch (Exception hybridEx)
        {
            Log.E("EngineCoordinator", $"Hybrid falhou: {hybridEx.GetType().Name}: {hybridEx.Message}");
        }

        multiMonitor:
        // Detecta configuração multi-monitor
        var monitorCount = MonitorHelper.GetMonitorCount();
        if (monitorCount > 1 && game.IsValid)
        {
            var gameMonitor = MonitorHelper.GetMonitorFromWindow(game.Hwnd);
            Log.I("EngineCoordinator", $"Multi-monitor: {monitorCount} telas, jogo no monitor {gameMonitor}");
        }
    }

    private async Task SelectCaptureSourceAsync()
    {
        var game = _captureTargetGame;
        var gameHwnd = game.IsValid ? game.Hwnd : IntPtr.Zero;

        // Save hwnd fallback
        if (gameHwnd != IntPtr.Zero)
            _captureTargetHwnd = gameHwnd;

        // WDA exclusion check
        if (game.IsValid && gameHwnd != IntPtr.Zero && WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            Log.I("EngineCoordinator", $"Jogo '{game.ProcessName}' usa WDA_EXCLUDEFROMCAPTURE — pulando WGC per-window, usando desktop/Hybrid");
        }

        // 1) WGC per-window (best) — async retries with delay, do not block pipeline lock
        
        if (game.IsValid && gameHwnd != IntPtr.Zero && IsWindowValidForWgc(gameHwnd)
            && !WdaHelper.IsExcludedFromCapture(gameHwnd))
        {
            const int maxRetries = 3;
            const int retryDelayMs = 400;

            // Ensure pump exists
            _wgcPump ??= new WindowsMessagePump();

            for (var attempt = 1; attempt <= maxRetries; attempt++)
            {
                WgcCaptureSource? wgc = null;
                try
                {
                    wgc = new WgcCaptureSource();
                    // Marshal Initialize + StartFramePump to the pump thread.
                    _wgcPump.Invoke(() =>
                    {
                        wgc.Initialize(_sharedDevice, gameHwnd);
                        wgc.StartFramePump();
                    });
                    _capture = wgc;
                    _status.Update(s => s.CaptureBackend = $"WGC:{game.ProcessName}");
                    Log.I("EngineCoordinator", $"Captura: janela '{game.ProcessName}' ({gameHwnd})");
                    return;
                }
                catch (Exception ex)
                {
                    wgc.Dispose();
                    var inner = ex.InnerException != null ? $" → {ex.InnerException.GetType().Name}: {ex.InnerException.Message}" : "";
                    if (attempt < maxRetries)
                    {
                        Log.W("EngineCoordinator", $"WGC per-window tentativa {attempt}/{maxRetries} falhou: {ex.Message}{inner} — retry em {retryDelayMs}ms (async)");
                        await Task.Delay(retryDelayMs);
                        continue;
                    }
                    else
                    {
                        Log.E("EngineCoordinator", $"WGC per-window tentativa {attempt}/{maxRetries} falhou: {ex.Message}{inner} — fallback");
                    }
                }
            }
        }

        // 2) WGC desktop (monitor)
        WgcCaptureSource? wgcDesktop = null;
        try
        {
            var gameMonitor = gameHwnd != IntPtr.Zero ? MonitorHelper.GetMonitorFromWindowHandle(gameHwnd) : IntPtr.Zero;
            _wgcPump ??= new WindowsMessagePump();
            wgcDesktop = new WgcCaptureSource();
            _wgcPump.Invoke(() =>
            {
                wgcDesktop.Initialize(_sharedDevice, IntPtr.Zero, gameMonitor);
                wgcDesktop.StartFramePump();
            });
            _capture = wgcDesktop;
            _status.Update(s => s.CaptureBackend = "WGC");
            Log.I("EngineCoordinator", "Captura: Windows Graphics Capture (desktop)");
            return;
        }
        catch (Exception wgcEx)
        {
            wgcDesktop?.Dispose();
            var inner = wgcEx.InnerException != null ? $" → {wgcEx.InnerException.GetType().Name}: {wgcEx.InnerException.Message}" : "";
            Log.E("EngineCoordinator", $"WGC desktop falhou: {wgcEx.GetType().Name}: {wgcEx.Message}{inner}");
        }

        // 3) DXGI Desktop Duplication (full monitor)
        try
        {
            var dxgi = new DxgiCaptureSource();
            dxgi.Initialize(_sharedDevice, gameHwnd);
            _capture = dxgi;
            _status.Update(s => s.CaptureBackend = "DXGI");
            Log.I("EngineCoordinator", "Captura: DXGI Desktop Duplication");
            return;
        }
        catch (Exception dxgiEx)
        {
            Log.E("EngineCoordinator", $"DXGI falhou: {dxgiEx.GetType().Name}: {dxgiEx.Message}");
        }

        // 4) Hybrid fallback
        try
        {
            var hybrid = new HybridCaptureSource();
            hybrid.Initialize(_sharedDevice, gameHwnd);
            _capture = hybrid;
            _status.Update(s => s.CaptureBackend = _capture.Name);
            Log.I("EngineCoordinator", $"Captura híbrida: HWND=0x{gameHwnd:X8}");
            return;
        }
        catch (Exception hybridEx)
        {
            Log.E("EngineCoordinator", $"Hybrid falhou: {hybridEx.GetType().Name}: {hybridEx.Message}");
        }

        // If all fail, leave _capture null and caller handles cleanup.
    }

    private int _lastCropX, _lastCropY, _lastCropW, _lastCropH;

    private void UpdateDxgiCropRect()
    {
        var game = ResolveTargetGame();
        int cropX = 0, cropY = 0, cropW = 0, cropH = 0;

        if (game.IsValid && game.Hwnd != IntPtr.Zero && DwmGetWindowAttribute(game.Hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out var rect, Marshal.SizeOf<RECT>()) == 0)
        {
            var hMon = MonitorHelper.GetMonitorFromWindowHandle(game.Hwnd);
            var (mLeft, mTop, mRight, mBottom) = MonitorHelper.GetMonitorRect(hMon);

            cropW = rect.Right - rect.Left;
            cropH = rect.Bottom - rect.Top;
            if (cropW > 0 && cropH > 0)
            {
                var clampedLeft = Math.Max(rect.Left, mLeft);
                var clampedTop = Math.Max(rect.Top, mTop);
                var clampedRight = Math.Min(rect.Right, mRight);
                var clampedBottom = Math.Min(rect.Bottom, mBottom);
                cropW = (clampedRight - clampedLeft) & ~1;
                cropH = (clampedBottom - clampedTop) & ~1;
                cropX = clampedLeft - mLeft;
                cropY = clampedTop - mTop;
                Log.I("UpdateDxgiCropRect", $"window={rect.Left}:{rect.Top}:{rect.Right}:{rect.Bottom} monitor={mLeft}:{mTop}:{mRight}:{mBottom} clamped={clampedLeft}:{clampedTop}:{clampedRight}:{clampedBottom} crop={cropX}:{cropY}:{cropW}:{cropH}");

                // Crop muito pequeno: GpuVideoConverter falha com E_INVALIDARG e ffmpeg produz output vazio.
                // Ignora crop e usa quadro completo quando abaixo de 320x240.
                if (cropW > 0 && (cropW < 320 || cropH < 240))
                {
                    Log.I("UpdateDxgiCropRect", $"Crop muito pequeno ({cropW}x{cropH}) — usando quadro completo");
                    cropW = 0;
                    cropH = 0;
                }
            }
        }

        if (_encoder != null && (cropX != _lastCropX || cropY != _lastCropY || cropW != _lastCropW || cropH != _lastCropH))
        {
            _encoder.SetCropRect(cropX, cropY, cropW, cropH);

            // Se crop cobre a tela inteira (crop=source=no-op), não precisa restartar ffmpeg
            bool isNoop = cropW == _captureWidth && cropH == _captureHeight && cropX == 0 && cropY == 0;
            if (!isNoop)
            {
                Log.E("UpdateDxgiCropRect", $"Crop real: {_lastCropX},{_lastCropY},{_lastCropW},{_lastCropH} → {cropX},{cropY},{cropW},{cropH}. Chamando Flush()...");
                _encoder.Flush();
            }
            else
            {
                Log.I("UpdateDxgiCropRect", $"Crop no-op (tela inteira) — Flush ignorado");
            }

            _lastCropX = cropX; _lastCropY = cropY; _lastCropW = cropW; _lastCropH = cropH;
        }
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("avrt.dll", SetLastError = true)]
    private static extern IntPtr AvSetMmThreadCharacteristicsW([MarshalAs(UnmanagedType.LPWStr)] string taskName, out uint taskIndex);

    [DllImport("avrt.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AvRevertMmThreadCharacteristics(IntPtr handle);

    private IntPtr _mmThreadHandle = IntPtr.Zero;

    private void SetMmThreadPriority()
    {
        uint index = 0;
        var ret = AvSetMmThreadCharacteristicsW("Capture", out index);
        if (ret == IntPtr.Zero)
            Log.D("EngineCoordinator", $"AvSetMmThreadCharacteristics('Capture') failed: {Marshal.GetLastWin32Error()}");
        else
            _mmThreadHandle = ret;
    }

    private void RevertMmThreadPriority()
    {
        if (_mmThreadHandle != IntPtr.Zero)
        {
            AvRevertMmThreadCharacteristics(_mmThreadHandle);
            _mmThreadHandle = IntPtr.Zero;
        }
    }
}
