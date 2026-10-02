namespace DiNho.Capture.Poc.Encoders;

/// <summary>
/// Caminho de conversão de um frame capturado para NV12 (T3).
/// </summary>
public enum ConvertPath
{
    /// <summary>Dimensões batem exatamente — blit 1:1, o caminho mais barato.</summary>
    GpuExact,

    /// <summary>
    /// A textura difere do alvo, mas cabe um blit escalado na GPU. Um resize de
    /// 1px (1932→1933) NÃO justifica converter 2 MP em software.
    /// </summary>
    GpuScaled,

    /// <summary>Só quando a GPU não pode atender: alvo degenerado ou cooldown.</summary>
    CpuFallback,
}

/// <summary>
/// Decide o caminho de conversão BGRA→NV12 sem tocar em GPU (T3).
///
/// <para>
/// Antes: <c>ConvertGpuNv12</c> comparava <c>texDesc.Width != _width</c> e caía
/// direto para <c>ConvertCpuNv12</c>. Em 2026-10-01 a janela do jogo mudou de
/// 1932x1052 para 1933x1052 e a conversão passou de ~2,2 ms para 70-75 ms por
/// frame — 30x mais lento, o encoder virou o gargalo e o save saiu truncado em
/// 152,82 s de 305,01 s esperados.
/// </para>
/// <para>
/// O que a GPU exige de verdade é que o <b>output</b> NV12 tenha dimensões pares
/// (plano de croma é subsampleado em 2x2). O input pode ser ímpar ou de qualquer
/// tamanho: o VideoProcessor escala. Por isso a decisão é
/// <see cref="ConvertPath.GpuScaled"/> e não <see cref="ConvertPath.CpuFallback"/>.
/// </para>
/// </summary>
public static class ConvertPathResolver
{
    /// <summary>
    /// <paramref name="texW"/>/<paramref name="texH"/>: dimensões REAIS da textura D3D11.
    /// <paramref name="wantW"/>/<paramref name="wantH"/>: dims declaradas pelo encoder.
    /// <paramref name="nv12W"/>/<paramref name="nv12H"/>: dims do buffer NV12 de saída.
    /// <paramref name="converterInCooldown"/>: a converter atual já falhou e está em carência.
    /// </summary>
    public static ConvertPath ResolveConvertPath(
        int texW, int texH,
        int wantW, int wantH,
        int nv12W, int nv12H,
        bool converterInCooldown)
    {
        // Sem geometria não há blit possível (frame degenerado de alt-tab,
        // encoder ainda não inicializado, ou escala de cascading fallback a 0).
        if (texW <= 0 || texH <= 0 || wantW <= 0 || wantH <= 0 || nv12W <= 0 || nv12H <= 0)
            return ConvertPath.CpuFallback;

        // NV12: Y em (nv12W x nv12H), UV em (nv12W/2 x nv12H/2). Output ímpar
        // não endereça o plano de croma — aí nem a GPU resolve.
        if ((nv12W & 1) != 0 || (nv12H & 1) != 0)
            return ConvertPath.CpuFallback;

        // Carência: reconstruir a converter por frame (1 construtor = recursos
        // GPU novos por frame) é pior que converter em CPU.
        if (converterInCooldown)
            return ConvertPath.CpuFallback;

        return texW == wantW && texH == wantH
            ? ConvertPath.GpuExact
            : ConvertPath.GpuScaled;
    }
}
