namespace DiNho.Capture.Poc.Logging;

public static class Log
{
    private static ILogger? _instance;
    private static readonly Lock _lock = new();

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

    /// <summary>
    /// Linha que não pode ser perdida em shutdown abrupto — flush imediato, sem
    /// esperar o lote de 64. Degrada para <see cref="I"/> se o logger instalado não
    /// implementar <see cref="ICriticalLogger"/> (o logger nunca pode lançar).
    /// </summary>
    public static void Critical(string source, string message)
    {
        var logger = Instance;
        if (logger is ICriticalLogger critical)
            critical.Critical(source, message);
        else
            logger.Info(source, message);
    }
}
