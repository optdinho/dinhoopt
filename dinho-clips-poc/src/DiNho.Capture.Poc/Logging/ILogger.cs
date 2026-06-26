namespace DiNho.Capture.Poc.Logging;

public enum LogLevel
{
    Debug,
    Info,
    Warning,
    Error
}

public interface ILogger
{
    void Debug(string source, string message);
    void Info(string source, string message);
    void Warning(string source, string message);
    void Error(string source, string message);
    void Log(LogLevel level, string source, string message);
}
