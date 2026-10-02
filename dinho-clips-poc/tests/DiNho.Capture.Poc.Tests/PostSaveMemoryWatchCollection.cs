// PostSaveMemoryWatch usa probes static (mesmo padrao de WorkingSetTrimmer e
// FeedTelemetry), e outra classe da suite desliga o watch ao exercitar
// SaveClipAsync. Sem isolar a colecao, os testes do watch rodariam em paralelo com
// essa alteracao de estado e a corrida tornaria Enabled flaky.
[CollectionDefinition("PostSaveMemoryWatch", DisableParallelization = true)]
public sealed class PostSaveMemoryWatchCollection
{
}
