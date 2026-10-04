using Xunit;

namespace DiNho.Capture.Poc.Tests;

// FfmpegPathResolver.OverridePathForTest() escreve em dois estaticos globais
// (_cachedPath e _cachedDir) e NAO tem qualquer sincronizacao.
//
// ClipExporterAtomicityTests e FfmpegPathResolverTests usam esse seam em colecoes
// diferentes, logo o xUnit as corre EM PARALELO: o `finally { OverridePathForTest(null); }`
// de uma classe apaga o caminho que a outra ainda esta a usar, e o export falha com
// "ffmpeg nao encontrado" (falha observada em
// ClipExporterAtomicityTests.EndToEnd_ExpectedAudioMissing_IsRejectedNotPublished).
//
// DisableParallelization mantem esta colecao sequencial E isolada das demais colecoes.
[CollectionDefinition("FfmpegPathOverride", DisableParallelization = true)]
public sealed class FfmpegPathOverrideCollection
{
}