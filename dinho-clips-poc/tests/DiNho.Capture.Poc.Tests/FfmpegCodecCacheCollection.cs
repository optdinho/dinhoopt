using Xunit;

namespace DiNho.Capture.Poc.Tests;

// FfmpegEncoder tem caches estáticos de módulo (melhor codec detectado, por codec) e
// EncoderManager tem seams estáticos de probe (VendorIdProbe/Av1HwProbe/ProbeEncoderProbe).
//
// EncoderManagerTests sobrescreve esses seams e ASSERTa o conteúdo do cache;
// FfmpegEncoderCapacityGuardTests chama FfmpegEncoder.ResetEncoderCachesForTest() para
// isolar cada caso. Em coleções diferentes as duas classes rodam EM PARALELO, então um
// Reset de uma apaga o cache no meio da asserção da outra (falha observada:
// DetectBestCodec_NativeAv1ProbeFails_ScaledVariantsSkipped_SelectsH264Amf).
//
// DisableParallelization mantém esta coleção sequencial E isolada das demais coleções.
[CollectionDefinition("FfmpegCodecCache", DisableParallelization = true)]
public sealed class FfmpegCodecCacheCollection
{
}
