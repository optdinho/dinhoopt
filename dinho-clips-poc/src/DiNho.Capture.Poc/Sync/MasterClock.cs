using System.Diagnostics;

namespace DiNho.Capture.Poc.Sync;

public sealed class MasterClock : IDisposable
{
    private static readonly long Frequency = Stopwatch.Frequency;
    private static readonly double TicksPerSecond = Frequency;

    private readonly long _startTimestamp;
    private readonly DateTime _referenceUtc;

    public MasterClock()
    {
        _startTimestamp = Stopwatch.GetTimestamp();
        _referenceUtc = DateTime.UtcNow;
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

    public long StartTimestamp => _startTimestamp;

    /// <summary>
    /// Converts a Stopwatch timestamp (from audio capture callback) to the clock's time base.
    /// Returns the TimeSpan since engine start when the capture happened.
    /// Uses the same Stopwatch that video PTS uses, eliminating DateTime/Stopwatch drift.
    /// </summary>
    public TimeSpan FromTimestamp(long captureTicks)
    {
        var elapsed = captureTicks - _startTimestamp;
        return TimeSpan.FromSeconds((double)elapsed / TicksPerSecond);
    }

    public void Dispose()
    {
    }
}
