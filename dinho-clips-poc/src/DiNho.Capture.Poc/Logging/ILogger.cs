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

/// <summary>
/// Linha que NÃO pode ser perdida num shutdown abrupto — o ConsoleLogger bufferiza
/// 64 linhas antes de fazer flush, então um export morto no meio (o app fecha, o
/// ffmpeg é killado) descarta o lote inteiro.
/// <para>
/// Incidente 2026-10-01: o clip <c>DiNho Optimizer 2026-10-01_09-51-12.mp4</c> ficou
/// quebrado em disco (sem <c>moov</c>) e <b>não tem nenhuma linha no JSONL</b> — nem
/// SAVE START, nem EXPORT FAILED. Sem essas linhas não existe como reconstruir o que
/// aconteceu na sessão seguinte.
/// </para>
/// <para>
/// Interface separada (e não um parâmetro em <see cref="ILogger.Log"/>) de propósito:
/// acrescentar uma assinatura quebraria os <c>ILogger</c> de teste e o
/// <c>SilentLogger</c> do module initializer sem ganhar nada — o requisito é
/// "esta linha vai para disco agora", não "esta linha tem outro nível".
/// </para>
/// </summary>
public interface ICriticalLogger
{
    /// <summary>Escreve a linha e força o flush imediato, ignorando o lote de 64.</summary>
    void Critical(string source, string message);
}
