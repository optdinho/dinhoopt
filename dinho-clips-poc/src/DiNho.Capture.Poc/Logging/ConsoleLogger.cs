using System.Diagnostics;

namespace DiNho.Capture.Poc.Logging;

public sealed class ConsoleLogger : ILogger, IDisposable
{
    private readonly TextWriter _writer;
    private readonly object _lock = new();
    private readonly bool _writeTimestamps;
    private bool _disposed;

    public ConsoleLogger(TextWriter? writer = null, bool writeTimestamps = true)
    {
        _writer = writer ?? Console.Error;
        _writeTimestamps = writeTimestamps;
    }

    public void Debug(string source, string message) => Log(LogLevel.Debug, source, message);
    public void Info(string source, string message) => Log(LogLevel.Info, source, message);
    public void Warning(string source, string message) => Log(LogLevel.Warning, source, message);
    public void Error(string source, string message) => Log(LogLevel.Error, source, message);

    public void Log(LogLevel level, string source, string message)
    {
        if (_disposed) return;
        var ts = _writeTimestamps ? $"{DateTime.Now:HH:mm:ss.fff} " : "";
        var line = $"{ts}[{level,-7}] [{source}] {message}";
        lock (_lock)
        {
            try { _writer.WriteLine(line); _writer.Flush(); }
            catch { /* silent fail — logger nunca quebra app */ }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _writer.Flush(); } catch { }
    }
}
