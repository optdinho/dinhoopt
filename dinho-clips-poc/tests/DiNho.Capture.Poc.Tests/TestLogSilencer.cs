using System.Runtime.CompilerServices;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Tests;

// Instala um logger no-op antes de qualquer teste rodar (module initializer).
// Motivo: o ConsoleLogger default escreve em Console.Error com flush por linha,
// e o vstest interpreta esse output durante testes de integracao que spawnam
// ffmpeg como falha do host ("Execucao de Teste Anulada"), abortando a suite
// antes de todas as classes executarem (ver AGENTS.md 2026-08-04/08-11).
// Testes que precisam capturar logs continuam usando InstallLogger/RecordingLogger,
// que sobrescrevem Log.Instance depois deste initializer.
internal static class TestLogSilencer
{
    [ModuleInitializer]
    internal static void Install()
    {
        Log.Instance = new SilentLogger();
    }

    private sealed class SilentLogger : ILogger
    {
        public void Debug(string source, string message) { }

        public void Info(string source, string message) { }

        public void Warning(string source, string message) { }

        public void Error(string source, string message) { }

        public void Log(LogLevel level, string source, string message) { }
    }
}
