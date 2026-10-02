namespace DiNho.Capture.Poc.Capture;

/// <summary>
/// Dimensões que o pipeline de captura realmente entregou (T3).
///
/// <para>
/// O encoder era inicializado com <c>captureItem.Size</c> lido UMA vez, no
/// start. Se a janela do jogo redimensiona (ou o DPI/alt-tab muda o content
/// size), o WGC passa a entregar frames de outra dimensão enquanto o encoder
/// continua acreditando na inicial — em 2026-10-01, 1932x1052 virou 1933x1052 e
/// a conversão caiu para CPU.
/// </para>
/// <para>
/// Value type de propósito: cada leitura é um snapshot, então o consumidor não
/// vê a geometria mudar no meio do frame. <see cref="Observe"/> devolve uma
/// instância nova em vez de mutar a atual.
/// </para>
/// <para>
/// <see cref="Pack"/> existe porque publicar W e H em dois campos não é atômico:
/// cada <c>Volatile.Read</c> é tear-free por campo, mas o PAR não é — dava para
/// ler a largura nova com a altura antiga e reportar uma geometria que ninguém
/// entregou. Em um <c>long</c> a troca é única e o par é consistente.
/// </para>
/// </summary>
public readonly record struct PipelineSize(int Width, int Height)
{
    public static readonly PipelineSize Zero = new(0, 0);

    /// <summary>
    /// Devolve o tamanho observado, ou <c>this</c> se o frame for degenerado.
    /// Frame 0x0 durante minimize não pode zerar a geometria do pipeline.
    /// </summary>
    public PipelineSize Observe(int width, int height) =>
        width <= 0 || height <= 0 ? this : new PipelineSize(width, height);

    /// <summary>Empacota o par em um long: W na metade alta, H na baixa.</summary>
    public static long Pack(in PipelineSize size) =>
        ((long)(uint)size.Width << 32) | (uint)size.Height;

    /// <summary>Desempacota o par gravado por <see cref="Pack"/>.</summary>
    public static PipelineSize Unpack(long packed) =>
        new((int)(packed >> 32), unchecked((int)(packed & 0xFFFFFFFFL)));

    public override string ToString() => $"{Width}x{Height}";
}
