using DiNho.Capture.Poc.Pipeline;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Padding de slots perdidos (2026-10-03). Quando a WGC não entrega frame nova — conteúdo
/// estático, <c>MinUpdateInterval</c> a estrangular (Microsoft #142) — o slot da grelha
/// continua a existir e tem de ser preenchido com a ÚLTIMA textura, senão o PTS abre um buraco.
///
/// É o <c>TexturePool</c> ping-pong que torna isto grátis: num miss o <c>TryCaptureFrame</c>
/// não chama <c>Rent</c>/<c>CopyResource</c> (ver <c>WgcCaptureSource.CreateNullTextureFrame</c>),
/// logo a textura do frame anterior continua válida e o
/// <c>CapturedFrame.Dispose()</c> é no-op com <c>OwnsTexture: false</c>.
///
/// A classe é <b>genérica</b> de propósito: o coordinator usa <c>ID3D11Texture2D</c> e os
/// testes usam <c>object</c>. Não há como testar D3D sem GPU, e a lógica de decisão
/// (quando padar, quando não, quando invalidar) é exatamente o que está em jogo.
/// </summary>
public sealed class FramePadderTests
{
    private sealed record Payload(string Name, int W, int H);

    private static FramePadder<Payload> Create(int maxConsecutive = 2)
        => new(maxConsecutive);

    // Sem frame real ainda não há o que repetir: um miss no arranque é um miss, não um dup.
    [Fact]
    public void TryPad_SemFrameAnterior_NaoPodePadar()
    {
        var p = Create();
        Assert.False(p.TryPad(out var payload));
        Assert.Null(payload);
        Assert.Equal(0, p.ConsecutiveDups);
    }

    // Miss isolado = 1 duplicata. Este é o caso dos ~124 deltas de 22-23 ms do clip real.
    [Fact]
    public void TryPad_AposUmFrameReal_ReutilizaOMesmoPayload()
    {
        var p = Create();
        var original = new Payload("f0", 1920, 1080);
        p.Observe(original);

        Assert.True(p.TryPad(out var payload));
        Assert.Same(original, payload);
        Assert.Equal(1, p.ConsecutiveDups);
    }

    // Pool 3 => 2 duplicados consecutivos. Sem o segundo, um ecrã quase estático a 30 fps
    // de entrega abriria 2 buracos de 16,667 ms por janela.
    [Fact]
    public void TryPad_AteOMaximoConsecutivo()
    {
        var p = Create(maxConsecutive: 2);
        p.Observe(new Payload("f0", 1920, 1080));

        Assert.True(p.TryPad(out _));
        Assert.Equal(1, p.ConsecutiveDups);
        Assert.True(p.TryPad(out _));
        Assert.Equal(2, p.ConsecutiveDups);
    }

    // Acima do máximo NÃO padamos: a run longa significa que a captura está a perder frames
    // de verdade (regra de diagnóstico do plano) e repetir o último frame seria mentir.
    [Fact]
    public void TryPad_AcimaDoMaximoConsecutivo_Recusa()
    {
        var p = Create(maxConsecutive: 2);
        p.Observe(new Payload("f0", 1920, 1080));
        p.TryPad(out _);
        p.TryPad(out _);

        Assert.False(p.TryPad(out var payload));
        Assert.Null(payload);
        Assert.Equal(2, p.ConsecutiveDups);
    }

    // Um frame novo reabre o orçamento: 2 dups, frame novo, mais 2 dups.
    [Fact]
    public void Observe_ReabreOrcamentoAposRunMaxima()
    {
        var p = Create(maxConsecutive: 2);
        p.Observe(new Payload("f0", 1920, 1080));
        p.TryPad(out _);
        p.TryPad(out _);
        Assert.False(p.TryPad(out _));

        p.Observe(new Payload("f1", 1920, 1080));
        Assert.Equal(0, p.ConsecutiveDups);
        Assert.True(p.TryPad(out var payload));
        Assert.Equal("f1", payload!.Name);
    }

    // Invalidate (reinit, device lost, mudança de alvo) limpa o cache: a textura antiga
    // pertence a um pool já descartado e usá-la seria um access violation.
    [Fact]
    public void Invalidate_EsqueceOPayloadAntigo()
    {
        var p = Create();
        p.Observe(new Payload("f0", 1920, 1080));
        Assert.True(p.TryPad(out _));

        p.Invalidate();

        Assert.False(p.TryPad(out _));
        Assert.Equal(0, p.ConsecutiveDups);
    }

    // Reinit também tem de fechar a run: um `dupMax` alto logo após um reinit é ruído.
    [Fact]
    public void Invalidate_ZeraARun()
    {
        var p = Create(maxConsecutive: 5);
        p.Observe(new Payload("f0", 1920, 1080));
        p.TryPad(out _);
        p.TryPad(out _);
        Assert.Equal(2, p.ConsecutiveDups);

        p.Invalidate();
        Assert.Equal(0, p.ConsecutiveDups);
    }

    // Mudança de dimensões invalida: um payload 1920x1080 nunca pode servir um slot 1280x720
    // (o encoder redimensionaria e o PTS deixaria de descrever a mesma imagem).
    [Theory]
    [InlineData(1280, 720)]
    [InlineData(2560, 1440)]
    public void TryPad_IgnoraPayloadDeOutraDimensao(int w, int h)
    {
        var p = Create();
        p.Observe(new Payload("f0", 1920, 1080), 1920, 1080);

        Assert.False(p.TryPad(out var payload, w, h));
        Assert.Null(payload);
        Assert.Equal((1920, 1080), p.PayloadDimensions);
    }

    // O payload só serve slots das MESMAS dimensões.
    [Fact]
    public void TryPad_AceptaPayloadDaMesmaDimensao()
    {
        var p = Create();
        p.Observe(new Payload("f0", 1920, 1080), 1920, 1080);
        Assert.True(p.TryPad(out _, 1920, 1080));
    }

    // Dimensão desconhecida (0) não filtra — o chamador que não a conhece ainda pode padar.
    [Fact]
    public void TryPad_DimensaoDesconhecida_NaoFiltra()
    {
        var p = Create();
        p.Observe(new Payload("f0", 1920, 1080), 1920, 1080);
        Assert.True(p.TryPad(out var payload, 0, 0));
        Assert.NotNull(payload);
    }

// Invalidate é idempotente: o loop pode chamar duas vezes seguidas (exceção + reinit).
    [Fact]
    public void Invalidate_Idempotente()
    {
        var p = Create();
        p.Observe(new Payload("f0", 1920, 1080));
        p.Invalidate();
        p.Invalidate();

        Assert.False(p.TryPad(out _));
    }

    // Sem payload observado, as dimensões são desconhecidas — não pode reportar lixo.
    [Fact]
    public void PayloadDimensions_SemFrame_EVazio()
    {
        var p = Create();
        Assert.Equal((0, 0), p.PayloadDimensions);
        Assert.False(p.HasPayload);
    }

    [Fact]
    public void MaxConsecutive_ConfiguravelEPositivo()
    {
        Assert.Equal(3, Create(3).MaxConsecutive);
        // 0 ou negativo cai para 1: sem budget, uma run longa nunca é ilimitada.
        Assert.Equal(1, Create(0).MaxConsecutive);
        Assert.Equal(1, Create(-4).MaxConsecutive);
    }
}