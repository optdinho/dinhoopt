using System;
using System.Collections.Concurrent;
using System.Threading;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Capture;

/// <summary>
/// Dedicated STA thread with a Windows message pump.
/// WGC FrameArrived needs a message pump on the thread that created the capture session
/// for the DWM to deliver frames. CreateFreeThreaded() alone is not sufficient on some
/// systems (e.g. RTX 5050 + FiveM).
/// </summary>
internal sealed class WindowsMessagePump : IDisposable
{
    private readonly Thread _thread;
    private readonly ConcurrentQueue<Action> _queue = new();
    private readonly ManualResetEventSlim _workAvailable = new(false);
    private readonly ManualResetEventSlim _ready = new(false);
    private volatile bool _disposed;

    public WindowsMessagePump()
    {
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "WGC-MsgPump"
        };
        _thread.TrySetApartmentState(ApartmentState.STA);
        _thread.Start();
        _ready.Wait(TimeSpan.FromSeconds(5));
    }

    /// <summary>Marshal an action to the pump thread and wait for completion.</summary>
    public void Invoke(Action action)
    {
        if (_disposed) return;
        var done = new ManualResetEventSlim(false);
        Exception? error = null;
        _queue.Enqueue(() =>
        {
            try { action(); }
            catch (Exception ex) { error = ex; }
            finally { done.Set(); }
        });
        _workAvailable.Set();
        done.Wait(TimeSpan.FromSeconds(10));
        done.Dispose();
        if (error != null)
            throw new AggregateException(error);
    }

    private void Run()
    {
        try
        {
            _ready.Set();
            int loopCount = 0;
            int msgCount = 0;

            while (!_disposed)
            {
                _workAvailable.Wait(TimeSpan.FromMilliseconds(100));
                _workAvailable.Reset();

                while (_queue.TryDequeue(out var action))
                    action();

                // Pump Windows messages (DWM delivers FrameArrived via message pump)
                while (PeekMessage(out var msg, IntPtr.Zero, 0, 0, PM_REMOVE))
                {
                    TranslateMessage(ref msg);
                    DispatchMessage(ref msg);
                    msgCount++;
                }

                loopCount++;
                if (loopCount % 500 == 0)
                    Log.D("WGC-Pump", $"Pump alive: loops={loopCount} msgs={msgCount} queueLen={_queue.Count}");
            }

            Log.I("WGC-Pump", $"Pump exiting: loops={loopCount} msgs={msgCount}");
        }
        catch (Exception ex)
        {
            Log.E("WGC-Pump", $"Message pump crashed: {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _workAvailable.Set();
        _thread.Join(2000);
        _workAvailable.Dispose();
        _ready.Dispose();
    }

    private const uint PM_REMOVE = 0x0001;

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    private static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);
}
