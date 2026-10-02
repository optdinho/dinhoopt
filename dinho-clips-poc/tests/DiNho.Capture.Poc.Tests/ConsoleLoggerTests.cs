using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Tests;

public class ConsoleLoggerTests
{
    private sealed class FakeTextWriter : TextWriter
    {
        public readonly List<string> Lines = [];
        public int FlushCount { get; private set; }

        public override void WriteLine(string? value) => Lines.Add(value ?? "");
        public override void Flush() => FlushCount++;
        public override System.Text.Encoding Encoding => System.Text.Encoding.UTF8;
    }

    // ── W6.8: buffered logger ──────────────────────────────────────

    [Fact]
    public void BufferedWrite_LogsAppearOnDispose()
    {
        var writer = new FakeTextWriter();
        using var logger = new ConsoleLogger(writer, writeTimestamps: false);

        logger.Info("src", "line-1");
        logger.Info("src", "line-2");

        // Before dispose, nothing flushed yet (< threshold)
        Assert.Equal(0, writer.FlushCount);

        logger.Dispose();
        Assert.Equal(1, writer.FlushCount);
        Assert.Equal(2, writer.Lines.Count);
        Assert.Contains("[src] line-1", writer.Lines[0]);
        Assert.Contains("[src] line-2", writer.Lines[1]);
    }

    [Fact]
    public void FlushThreshold_FlushesAutomaticallyAt64()
    {
        var writer = new FakeTextWriter();
        var logger = new ConsoleLogger(writer, writeTimestamps: false);

        // First 63 lines should NOT flush
        for (int i = 0; i < 63; i++)
            logger.Info("src", $"msg-{i}");

        Assert.Equal(0, writer.FlushCount);
        Assert.Empty(writer.Lines);

        // 64th line triggers flush
        logger.Info("src", "msg-63");
        Assert.Equal(1, writer.FlushCount);
        Assert.Equal(64, writer.Lines.Count);

        logger.Dispose();
    }

    [Fact]
    public void Dispose_AlwaysFlushes_ResidualLines()
    {
        var writer = new FakeTextWriter();
        var logger = new ConsoleLogger(writer, writeTimestamps: false);

        // 10 lines — below threshold
        for (int i = 0; i < 10; i++)
            logger.Info("src", $"line-{i}");

        logger.Dispose();
        Assert.Equal(1, writer.FlushCount);
        Assert.Equal(10, writer.Lines.Count);
    }

    [Fact]
    public void Log_AfterDispose_DoesNotThrow()
    {
        var writer = new FakeTextWriter();
        using var logger = new ConsoleLogger(writer);
        logger.Dispose();

        // Should be safe — no-op
        var ex = Record.Exception(() => logger.Info("src", "late"));
        Assert.Null(ex);
    }

    // ── T6: linhas críticas sobrevivem a shutdown (buffer de 64 linhas) ──
    //
    // Incidente 2026-10-01: o clip "09-51-12" existe em disco mas não tem NENHUMA
    // linha no JSONL — nem SAVE START, nem EXPORT FAILED. O lote de 64 linhas foi
    // descartado quando o processo morreu durante o export. Sem a linha crítica no
    // disco não existe como investigar o arquivo quebrado na sessão seguinte.

    [Fact]
    public void Critical_FlushesImmediately_WithoutWaitingForThreshold()
    {
        var writer = new FakeTextWriter();
        using var logger = new ConsoleLogger(writer, writeTimestamps: false);

        logger.Critical("EngineCoordinator", "SAVE START");

        // 1 linha crítica = flush imediato, sem esperar as 64 do lote.
        Assert.Equal(1, writer.FlushCount);
        Assert.Single(writer.Lines);
        Assert.Contains("SAVE START", writer.Lines[0]);
    }

    [Fact]
    public void Critical_FlushesPrecedingBufferedLinesInSameOrder()
    {
        var writer = new FakeTextWriter();
        using var logger = new ConsoleLogger(writer, writeTimestamps: false);

        logger.Info("src", "a");
        logger.Info("src", "b");
        Assert.Equal(0, writer.FlushCount);

        logger.Critical("src", "c");

        // As linhas em buffer NÃO podem ser perdidas nem reordenadas pela crítica.
        Assert.Equal(1, writer.FlushCount);
        Assert.Equal(3, writer.Lines.Count);
        Assert.EndsWith("] a", writer.Lines[0]);
        Assert.EndsWith("] b", writer.Lines[1]);
        Assert.EndsWith("] c", writer.Lines[2]);
    }

    [Fact]
    public void Critical_AfterDispose_DoesNotThrow()
    {
        var writer = new FakeTextWriter();
        using var logger = new ConsoleLogger(writer);
        logger.Dispose();

        var ex = Record.Exception(() => logger.Critical("src", "late-critical"));
        Assert.Null(ex);
    }

    [Fact]
    public void Critical_ThenDispose_DoesNotDoubleFlushEmptyBuffer()
    {
        var writer = new FakeTextWriter();
        using var logger = new ConsoleLogger(writer, writeTimestamps: false);

        logger.Critical("src", "only-critical");
        Assert.Equal(1, writer.FlushCount);

        logger.Dispose();
        // O buffer já foi drenado pela crítica — o Dispose não deve "flushear" vazio.
        Assert.Equal(1, writer.FlushCount);
    }

    // ── Log.Critical: dispatch para ICriticalLogger / fallback ───────

    [Fact]
    public void Log_Critical_DispatchesToCriticalLogger()
    {
        var logger = new CriticalRecordingLogger();
        var prev = Log.Instance;
        try
        {
            Log.Instance = logger;
            Log.Critical("src", "msg");
            Assert.Equal(1, logger.CriticalCalls);
        }
        finally { Log.Instance = prev; }
    }

    [Fact]
    public void Log_Critical_FallsBackToInfo_WhenLoggerIsNotCritical()
    {
        // SilentLogger (instalado pelo module initializer) NÃO implementa
        // ICriticalLogger — Log.Critical não pode lançar, tem de degradar.
        var logger = new PlainRecordingLogger();
        var prev = Log.Instance;
        try
        {
            Log.Instance = logger;
            // Log.Instance é um static global e o xunit roda classes em
            // paralelo: outro teste pode logar Info no meio. Contamos o
            // delta, não o absoluto.
            var before = logger.InfoCalls;
            var ex = Record.Exception(() => Log.Critical("src", "msg"));
            Assert.Null(ex);
            Assert.True(logger.InfoCalls > before, "o fallback para Info não aconteceu");
            Assert.Equal(0, logger.CriticalCalls);
        }
        finally { Log.Instance = prev; }
    }

    private sealed class CriticalRecordingLogger : ILogger, ICriticalLogger
    {
        public int CriticalCalls;
        public void Critical(string source, string message) => CriticalCalls++;
        public void Debug(string source, string message) { }
        public void Info(string source, string message) { }
        public void Warning(string source, string message) { }
        public void Error(string source, string message) { }
        public void Log(LogLevel level, string source, string message) { }
    }

    private sealed class PlainRecordingLogger : ILogger
    {
        // Volatile porque o Log.Instance é global e o xunit paraleliza: outra
        // thread pode estar contando no mesmo instante.
        private int _infoCalls;

        public int InfoCalls => Volatile.Read(ref _infoCalls);
        public int CriticalCalls => 0; // não implementa ICriticalLogger por desenho

        public void Debug(string source, string message) { }
        public void Info(string source, string message) => Interlocked.Increment(ref _infoCalls);
        public void Warning(string source, string message) { }
        public void Error(string source, string message) { }
        public void Log(LogLevel level, string source, string message) { }
    }
}
