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
    private readonly LinkedList<double> _frameTimesMs = new();
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

    public void ReportGoodFrame(double elapsedMs)
    {
        _totalFrames++;
        _consecutiveGood = Math.Min(_consecutiveGood + 1, ConsecutiveGoodReset * 2);
        _lastFrameTime = DateTime.UtcNow;

        lock (_frameTimesMs)
        {
            _frameTimesMs.AddLast(elapsedMs);
            while (_frameTimesMs.Count > 0 && _frameTimesMs.First!.Value < elapsedMs - _healthWindow.TotalMilliseconds)
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
        return _consecutiveGood == 0 && _lastIssueTime != DateTime.MinValue
            && (DateTime.UtcNow - _lastIssueTime).TotalSeconds > 3;
    }

    public PipelineHealth GetHealth()
    {
        var p95 = 0.0;
        lock (_frameTimesMs)
        {
            if (_frameTimesMs.Count > 0)
            {
                var sorted = new List<double>(_frameTimesMs);
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
            AvgFrameTimeMs = _frameTimesMs.Count > 0 ? _frameTimesMs.Average() : 0,
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