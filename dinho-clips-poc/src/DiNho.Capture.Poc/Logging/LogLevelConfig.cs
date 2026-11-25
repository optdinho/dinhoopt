namespace DiNho.Capture.Poc.Logging;

/// <summary>
/// Nível mínimo do logger de console. O default é <see cref="LogLevel.Info"/>:
/// ~78% das linhas do engine são Debug (WGC por frame, AudioDiag por pacote,
/// stderr do ffmpeg), e filtrá-las reduz o JSONL de ~95 MB para uma ordem de
/// grandeza menor sem perder Warning/Error nem as linhas CRITICAL.
/// <para>
/// Suporte pode pedir o diagnóstico completo com
/// <c>DINHO_CLIPS_LOG_LEVEL=debug</c> no arranque do Electron — o engine é
/// filho do Electron e herda <c>process.env</c>, não é preciso mudar o spawn.
/// </para>
/// </summary>
public static class LogLevelConfig
{
    public const string EnvironmentVariable = "DINHO_CLIPS_LOG_LEVEL";

    /// <summary>Valor ausente, vazio ou inválido cai no default — nunca desliga o log.</summary>
    public static LogLevel Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return LogLevel.Info;
        // Enum.TryParse aceita numeros ("99") como membros definidos? Nao:
        // IsDefined e' o que impede um typo de filtrar tambem Warning/Error.
        return Enum.TryParse<LogLevel>(value, ignoreCase: true, out var level) && Enum.IsDefined(level)
            ? level
            : LogLevel.Info;
    }

    public static LogLevel FromEnvironment() =>
        Parse(Environment.GetEnvironmentVariable(EnvironmentVariable));
}
