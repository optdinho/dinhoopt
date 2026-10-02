using System.Diagnostics;

namespace DiNho.Capture.Poc.Logging;

public sealed class ConsoleLogger : ILogger, ICriticalLogger, IDisposable
{
    private readonly TextWriter _writer;
    private readonly Lock _lock = new();
    private readonly bool _writeTimestamps;
    private readonly List<string> _buffer = new();
    private const int FlushThreshold = 64;
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
            _buffer.Add(line);
            // 6.8: bufferiza e faz flush a cada 64 linhas — evita flush síncrono
            // por linha no hot path de captura (PipelineDiag/FeedTelemetry/RAM).
            if (_buffer.Count >= FlushThreshold) FlushLocked();
        }
    }

    /// <summary>
    /// Linha crítica (SAVE START/OK, EXPORT FAILED): vai para disco na hora, sem
    /// esperar as 64 do lote. Ver <see cref="ICriticalLogger"/>.
    /// </summary>
    public void Critical(string source, string message)
    {
        if (_disposed) return;
        var ts = _writeTimestamps ? $"{DateTime.Now:HH:mm:ss.fff} " : "";
        var line = $"{ts}[CRITICAL] [{source}] {message}";
        lock (_lock)
        {
            // Enfileira (para não perder nem reordenar o que já está no buffer) e
            // drena tudo em seguida — uma única escrita no writer.
            _buffer.Add(line);
            FlushLocked();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        lock (_lock)
        {
            FlushLocked();
        }
    }

    private void FlushLocked()
    {
        if (_buffer.Count == 0) return;
        try
        {
            foreach (var line in _buffer)
                _writer.WriteLine(line);
            _buffer.Clear();
            _writer.Flush();
        }
        catch
        {
            // logger nunca quebra o app — descarta buffer em falha de escrita
            _buffer.Clear();
        }
    }
}
