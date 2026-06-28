namespace DiNho.Capture.Poc.Watchdog;

public enum HealthLevel { Green, Yellow, Red }

public enum PipelineIssue
{
    NoFrame,
    CaptureError,
    EncodeError,
    AudioHiccup,
    ApiSwitch,
    ReinitRequired,
    ExportStall
}

public sealed class PipelineHealth
{
    public HealthLevel Level { get; set; }
    public int TotalFrames { get; set; }
    public int DroppedFrames { get; set; }
    public double DropRatePct => TotalFrames > 0 ? DroppedFrames * 100.0 / TotalFrames : 0;
    public double AvgFrameTimeMs { get; set; }
    public double P95FrameTimeMs { get; set; }
    public PipelineIssue? LastIssue { get; set; }
    public int ConsecutiveGoodFrames { get; set; }
    public int ApiSwitches { get; set; }
    public int ExportStalls { get; set; }
    public bool ReinitRequested { get; set; }
}

public sealed class PipelineWatchdog
{
    private readonly TimeSpan _healthWindow = TimeSpan.FromSeconds(10);
    private readonly LinkedList<(DateTime timestamp, double durationMs)> _frameTimesMs = new();
    private int _totalFrames;
    private int _droppedFrames;
    private int _consecutiveGood;
    private PipelineIssue? _lastIssue;
    private DateTime _lastFrameTime = DateTime.MinValue;
    private DateTime _lastIssueTime = DateTime.MinValue;
    private int _apiSwitches;
    private int _exportStalls;

    public int BadFrameThreshold { get; set; } = 10;
    public int ConsecutiveGoodReset { get; set; } = 30;
    public double MaxStableFrameMs { get; set; } = 33.0;

    public void ReportGoodFrame(double durationMs)
    {
        _totalFrames++;
        _consecutiveGood = Math.Min(_consecutiveGood + 1, ConsecutiveGoodReset * 2);
        _lastFrameTime = DateTime.UtcNow;

        var now = _lastFrameTime;
        lock (_frameTimesMs)
        {
            _frameTimesMs.AddLast((now, durationMs));
            while (_frameTimesMs.Count > 0 && (now - _frameTimesMs.First!.Value.timestamp).TotalMilliseconds > _healthWindow.TotalMilliseconds)
                _frameTimesMs.RemoveFirst();
        }
    }

    public void ReportDroppedFrame(PipelineIssue issue)
    {
        _totalFrames++;
        _droppedFrames++;
        _consecutiveGood = 0;
        _lastIssue = issue;
        _lastIssueTime = DateTime.UtcNow;
    }

    public void ReportApiSwitch()
    {
        _apiSwitches++;
    }

    public void ReportExportStall()
    {
        _exportStalls++;
        _consecutiveGood = 0;
        _lastIssue = PipelineIssue.ExportStall;
        _lastIssueTime = DateTime.UtcNow;
    }

    public bool ShouldReinit()
    {
        // Quick reinit: no good frames at all for 3+ seconds
        if (_consecutiveGood == 0 && _lastIssueTime != DateTime.MinValue
            && (DateTime.UtcNow - _lastIssueTime).TotalSeconds > 3)
            return true;

        // Drop-rate reinit: persistent >50% drop rate for 5+ seconds
        // Prevents a single good frame from masking a fundamentally broken pipeline.
        if (_droppedFrames > BadFrameThreshold && _totalFrames > BadFrameThreshold)
        {
            double dropRate = (double)_droppedFrames / _totalFrames;
            if (dropRate > 0.5 && (DateTime.UtcNow - _lastIssueTime).TotalSeconds > 5)
                return true;
        }

        return false;
    }

    public PipelineHealth GetHealth()
    {
        var p95 = 0.0;
        lock (_frameTimesMs)
        {
            if (_frameTimesMs.Count > 0)
            {
                var sorted = new List<double>(_frameTimesMs.Select(f => f.durationMs));
                sorted.Sort();
                p95 = sorted[(int)(sorted.Count * 0.95)];
            }
        }

        var level = _consecutiveGood >= ConsecutiveGoodReset
            ? HealthLevel.Green
            : _consecutiveGood > 0 || _droppedFrames < BadFrameThreshold
                ? HealthLevel.Yellow
                : HealthLevel.Red;

        return new PipelineHealth
        {
            Level = level,
            TotalFrames = _totalFrames,
            DroppedFrames = _droppedFrames,
            AvgFrameTimeMs = _frameTimesMs.Count > 0 ? _frameTimesMs.Average(f => f.durationMs) : 0,
            P95FrameTimeMs = p95,
            LastIssue = _lastIssue,
            ConsecutiveGoodFrames = _consecutiveGood,
            ApiSwitches = _apiSwitches,
            ExportStalls = _exportStalls,
            ReinitRequested = ShouldReinit()
        };
    }

    public void Reset()
    {
        _totalFrames = 0;
        _droppedFrames = 0;
        _consecutiveGood = 0;
        _lastIssue = null;
        _lastFrameTime = DateTime.MinValue;
        _lastIssueTime = DateTime.MinValue;
        _apiSwitches = 0;
        _exportStalls = 0;
        lock (_frameTimesMs) { _frameTimesMs.Clear(); }
    }
}