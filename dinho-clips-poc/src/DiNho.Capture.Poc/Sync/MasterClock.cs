using System.Diagnostics;

namespace DiNho.Capture.Poc.Sync;

public sealed class MasterClock : IDisposable
{
    private static readonly long Frequency = Stopwatch.Frequency;
    private static readonly double TicksPerSecond = Frequency;

    private readonly long _startTimestamp;

    public MasterClock()
    {
        _startTimestamp = Stopwatch.GetTimestamp();
    }

    public TimeSpan Now
    {
        get
        {
            var elapsed = Stopwatch.GetTimestamp() - _startTimestamp;
            return TimeSpan.FromSeconds((double)elapsed / TicksPerSecond);
        }
    }

    public long NowHns => (long)(Now.TotalMilliseconds * 10000.0);

    public static TimeSpan FromTimestamp(long timestamp)
    {
        return TimeSpan.FromSeconds((double)timestamp / TicksPerSecond);
    }

    public void Dispose()
    {
    }
}
