using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Tests;

public class LogLevelConfigTests
{
    [Theory]
    [InlineData("debug", LogLevel.Debug)]
    [InlineData("DEBUG", LogLevel.Debug)]
    [InlineData("Info", LogLevel.Info)]
    [InlineData("warning", LogLevel.Warning)]
    [InlineData("eRrOr", LogLevel.Error)]
    public void Parse_RecognizesLevelNamesIgnoringCase(string value, LogLevel expected)
    {
        Assert.Equal(expected, LogLevelConfig.Parse(value));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("verbose")]
    // Enum.TryParse aceita numeros como "99": sem Enum.IsDefined isso calaria
    // TODA a informacao (inclusive Warning/Error) por um typo.
    [InlineData("99")]
    public void Parse_FallsBackToInfo(string? value)
    {
        Assert.Equal(LogLevel.Info, LogLevelConfig.Parse(value));
    }

    [Fact]
    public void FromEnvironment_ReadsDinhoClipsLogLevel()
    {
        var original = Environment.GetEnvironmentVariable(LogLevelConfig.EnvironmentVariable);
        try
        {
            Environment.SetEnvironmentVariable(LogLevelConfig.EnvironmentVariable, "debug");
            Assert.Equal(LogLevel.Debug, LogLevelConfig.FromEnvironment());

            Environment.SetEnvironmentVariable(LogLevelConfig.EnvironmentVariable, "nonsense");
            Assert.Equal(LogLevel.Info, LogLevelConfig.FromEnvironment());
        }
        finally
        {
            Environment.SetEnvironmentVariable(LogLevelConfig.EnvironmentVariable, original);
        }
    }
}
