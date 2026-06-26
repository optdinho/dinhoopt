namespace DiNho.Capture.Poc.Logging;

public static class Log
{
    private static ILogger? _instance;
    private static readonly object _lock = new();

    public static ILogger Instance
    {
        get
        {
            if (_instance == null)
            {
                lock (_lock)
                {
                    _instance ??= new ConsoleLogger();
                }
            }
            return _instance;
        }
        set
        {
            lock (_lock) { _instance = value; }
        }
    }

    public static void D(string source, string message) => Instance.Debug(source, message);
    public static void I(string source, string message) => Instance.Info(source, message);
    public static void W(string source, string message) => Instance.Warning(source, message);
    public static void E(string source, string message) => Instance.Error(source, message);
}
