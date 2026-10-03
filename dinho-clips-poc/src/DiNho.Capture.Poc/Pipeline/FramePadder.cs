namespace DiNho.Capture.Poc.Pipeline;

/// <summary>
/// Decide quando um slot perdido da grelha CFR é preenchido com uma duplicata do último
/// frame, e com que payload. Ver <c>docs/plans/clips-cfr-60fps-padding-2026-10-03.md</c>.
///
/// <para><b>Porque é grátis.</b> O <c>TexturePool</c> ping-pong já é o cache de duplicação:
/// num miss a WGC não chama <c>Rent</c>/<c>CopyResource</c>
/// (<c>WgcCaptureSource.CreateNullTextureFrame</c>), logo a textura do frame anterior
/// continua válida, e o <c>CapturedFrame.Dispose()</c> é no-op com <c>OwnsTexture: false</c>.
/// Pool 2 => 1 duplicado consecutivo; pool 3 => 2, por ~8,3 MB de VRAM.</para>
///
/// <para><b>Onde está o limite.</b> Acima de <see cref="MaxConsecutive"/> <b>não</b>
/// padamos. Uma run longa significa que a captura está genuinamente a perder frames —
/// repetir o último frame seria mentir sobre o conteúdo. A telemetria
/// (<c>FeedTelemetry.MaxConsecutiveDup</c>) existe para tornar essa run visível; a regra de
/// diagnóstico do plano manda parar a investigating quando <c>dup</c> passa de 10% dos ticks.</para>
///
/// <para><b>Porquê genérica.</b> O coordinator instancia com <c>ID3D11Texture2D</c>; os testes
/// com <c>object</c>. A política de decisão é o que está em jogo e não pode ser testada sem GPU.</para>
/// </summary>
/// <typeparam name="T">Payload a repetir — a textura no hot path.</typeparam>
internal sealed class FramePadder<T> where T : class
{
    private T? _payload;
    private int _consecutiveDups;
    private int _w, _h;

    internal FramePadder(int maxConsecutive)
        => MaxConsecutive = Math.Max(1, maxConsecutive);

    /// <summary>
    /// Budget de duplicatas consecutivas (<c>poolSize − 1</c>). Acima disso, o miss é
    /// reportado como drop: a captura está a perder frames de verdade.
    /// </summary>
    internal int MaxConsecutive { get; }

    /// <summary>Duplicatas consecutivas em curso nesta run.</summary>
    internal int ConsecutiveDups => _consecutiveDups;

    /// <summary>Há payload retido? (Após <see cref="Invalidate"/>, não.)</summary>
    internal bool HasPayload => _payload is not null;

    /// <summary>Dimensões do payload retido — <c>(0,0)</c> se não houver.</summary>
    internal (int W, int H) PayloadDimensions => (_w, _h);

    /// <summary>
    /// Regista uma frame real e abre o orçamento de duplicatas. As dimensões ficam
    /// associateadas ao payload para que um slot de outra dimensão não possa repeti-lo.
    /// </summary>
    /// <param name="width">Largura do payload; <c>0</c> = desconhecida (aceita qualquer slot).</param>
    internal void Observe(T payload, int width = 0, int height = 0)
    {
        _payload = payload;
        _w = width;
        _h = height;
        _consecutiveDups = 0;
    }

    /// <summary>
    /// Tenta preencher o slot corrente com uma duplicata. Retorna <c>false</c> (e não
    /// produz payload) quando não há frame anterior, quando a run já atingiu
    /// <see cref="MaxConsecutive"/>, ou quando o slot pede dimensões diferentes — nesses
    /// casos o caller deve tratar o tick como miss real.
    /// </summary>
    /// <param name="width">Dimensão pedida pelo slot; <c>0</c> = não filtrar.</param>
    internal bool TryPad(out T? payload, int width = 0, int height = 0)
    {
        payload = null;
        if (_payload is null) return false;
        if (_consecutiveDups >= MaxConsecutive) return false;
        if (width != 0 && height != 0 && (width != _w || height != _h)) return false;

        _consecutiveDups++;
        payload = _payload;
        return true;
    }

    /// <summary>
    /// Esquece o payload retido e fecha a run. Obrigatório em reinit, device lost, troca de
    /// alvo e mudança de resolução: a textura anterior pertence a um pool descartado e
    /// reutilizá-la seria um access violation (ou pior, uma imagem de outro tamanho).
    /// Idempotente — o loop pode chamá-lo mais do que uma vez.
    /// </summary>
    internal void Invalidate()
    {
        _payload = null;
        _w = 0;
        _h = 0;
        _consecutiveDups = 0;
    }
}