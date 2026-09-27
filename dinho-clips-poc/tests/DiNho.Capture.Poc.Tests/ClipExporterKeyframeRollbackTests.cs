using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Item 4 (GOP 120 → 60): observabilidade do rollback de I-frame.
///
/// Sem B-frames (item 7 ainda não implementado), um corte só pode começar num I-frame.
/// O ClipExporter recua até o último keyframe ANTES do ponto pedido. Com GOP 60 (1 s a
/// 60fps) o teto do rollback caiu de 2 s para 1 s — e isso é um número que o usuário
/// percebe ("o clip começa antes do que eu pedi"). Precisa ser MEDIDO, não adivinhado:
/// sem seam + log, o item vira "funciona?" e a próxima sessão de debug não tem dado.
///
/// O que estes testes travam:
///   1. o rollback aponta para o keyframe imediatamente anterior ao alvo (nunca para um
///      keyframe depois dele — isso cortaria o início do clipe);
///   2. com GOP 60 e 60 fps, o rollback nunca passa de 1 s (o teto prometido pelo item);
///   3. casos degenerados (alvo já no keyframe, lista sem keyframe, trimIdx 0) devolvem o
///      trimIdx pedido e NÃO inventam um índice negativo.
/// </summary>
public class ClipExporterKeyframeRollbackTests
{
    [Fact]
    public void ResolveKeyframeRollback_RollsBackToLastKeyframeBeforeTarget()
    {
        // 180 frames a 60fps = 3 s, keyframe a cada 60 (GOP 60) ⇒ I-frames em 0, 60, 120.
        // Pede o corte no frame 150 (2,5 s), que está NO MEIO de um GOP → recua até o
        // último I-frame antes dele, o frame 120 (2,0 s).
        var packets = BuildKeyframedRun(180, keyEvery: 60);

        var result = ClipExporter.ResolveKeyframeRollback(packets, trimIdx: 150, TimeSpan.FromSeconds(2.5));

        Assert.Equal(120, result.TrimIndex);
        Assert.Equal(TimeSpan.FromSeconds(2.0), result.KeyframePts);
        Assert.Equal(TimeSpan.FromSeconds(0.5), result.Rollback);
    }

    [Fact]
    public void ResolveKeyframeRollback_WorstCaseInGop_IsJustUnderOneSecond()
    {
        // Pior caso do GOP 60: o alvo é o ÚLTIMO frame antes do próximo I-frame (frame 119,
        // 1,983 s). O keyframe anterior é o 60 (1,0 s) ⇒ rollback de 983 ms. Com o GOP 120
        // antigo esse mesmo ponto recuaria até 2 s; é esse o teto que o Item 4 prometeu
        // reduzir pela metade, e o teste mede em vez de assumir.
        var packets = BuildKeyframedRun(180, keyEvery: 60);

        var result = ClipExporter.ResolveKeyframeRollback(
            packets, trimIdx: 119, packets[119].Pts);

        Assert.Equal(60, result.TrimIndex);
        // Rollback é medido contra o ALVO (1,983 s), não contra o keyframe: 983 ms é
        // literalmente "quanto antes do que eu pedi o clip vai começar".
        Assert.Equal(TimeSpan.FromSeconds(119.0 / 60.0) - TimeSpan.FromSeconds(1.0), result.Rollback);
        Assert.True(result.Rollback < TimeSpan.FromSeconds(1.0),
            $"rollback de {result.Rollback.TotalMilliseconds:F0}ms deveria ficar abaixo de 1 s");
    }

    [Fact]
    public void ResolveKeyframeRollback_TargetAlreadyOnKeyframe_DoesNotRollBack()
    {
        // O frame 120 É um I-frame → lastKey == trimIdx, não há o que corrigir.
        var packets = BuildKeyframedRun(180, keyEvery: 60);

        var result = ClipExporter.ResolveKeyframeRollback(packets, trimIdx: 120, TimeSpan.FromSeconds(2.0));

        Assert.Equal(120, result.TrimIndex);
        Assert.Equal(TimeSpan.Zero, result.Rollback);
    }

    [Fact]
    public void ResolveKeyframeRollback_AtOrBeforeFirstKeyframe_KeepsTrimIndex()
    {
        // O frame 0 é sempre I-frame. Se o alvo é o frame 0, o clip começa nele (trimIdx=0);
        // recuar mais faria o clip começar "antes de zero".
        var packets = BuildKeyframedRun(180, keyEvery: 60);

        var result = ClipExporter.ResolveKeyframeRollback(packets, trimIdx: 0, TimeSpan.Zero);

        Assert.Equal(0, result.TrimIndex);
        Assert.Equal(TimeSpan.Zero, result.Rollback);
    }

    [Fact]
    public void ResolveKeyframeRollback_NoKeyframeBeforeTarget_KeepsTrimIndex()
    {
        // Lista sem NENHUM I-frame (encoder defeituoso/corrupção do stream): não há para onde
        // recuar e recuar para -1 não é opção. Mantém o trimIdx pedido e reporta rollback
        // zero — o log honesto vale mais que um índice negativo silencioso.
        var packets = BuildKeyframedRun(180, keyEvery: 0);

        var result = ClipExporter.ResolveKeyframeRollback(packets, trimIdx: 120, TimeSpan.FromSeconds(2.0));

        Assert.Equal(120, result.TrimIndex);
        Assert.Equal(TimeSpan.Zero, result.Rollback);
        Assert.Equal(TimeSpan.Zero, result.KeyframePts);
    }

    [Fact]
    public void ResolveKeyframeRollback_NeverRollsBackPastTheFirstPacket()
    {
        // trimIdx aponta para um pacote cujo PTS ainda não é o do alvo (o chamador passa o
        // primeiro pacote com Pts+Duration > target): o rollback para no frame 0, nunca -1.
        var packets = BuildKeyframedRun(180, keyEvery: 60);

        var result = ClipExporter.ResolveKeyframeRollback(packets, trimIdx: 5, TimeSpan.FromSeconds(0.5));

        Assert.Equal(0, result.TrimIndex);
        Assert.Equal(TimeSpan.Zero, result.KeyframePts);
        Assert.True(result.TrimIndex >= 0, "trimIndex não pode ficar negativo");
    }

    [Fact]
    public void ResolveKeyframeRollback_RollbackNeverExceedsGop60()
    {
        // Trava a promessa do item: com GOP 60 a 60 fps o rollback é de no máximo 1 s.
        // Varre TODO o meio de um GOP (o pior caso é o alvo logo após um keyframe) e
        // também a vizinhança de cada keyframe, onde o salto é o maior.
        var packets = BuildKeyframedRun(300, keyEvery: 60);
        var gopCeiling = TimeSpan.FromSeconds(1.0) + TimeSpan.FromTicks(1);

        foreach (var trimIdx in Enumerable.Range(0, packets.Count))
        {
            var result = ClipExporter.ResolveKeyframeRollback(
                packets, trimIdx, packets[trimIdx].Pts);

            Assert.True(result.Rollback <= gopCeiling,
                $"rollback de {result.Rollback.TotalSeconds:F3}s no trimIdx {trimIdx} excede o GOP 60");
            Assert.True(result.TrimIndex <= trimIdx,
                $"trimIdx {result.TrimIndex} avançou o corte (pedido {trimIdx})");
            Assert.True(result.TrimIndex >= 0, "trimIndex ficou negativo");
        }
    }

    [Fact]
    public void ResolveKeyframeRollback_KeyframePtsAlwaysMatchesChosenIndex()
    {
        // Invariante do relatório: o PTS registrado é o do keyframe ESCOLHIDO, não o do
        // alvo nem o do trim original — é o que o log vai mostrar ao usuário.
        var packets = BuildKeyframedRun(240, keyEvery: 60);

        foreach (var trimIdx in Enumerable.Range(0, packets.Count))
        {
            var result = ClipExporter.ResolveKeyframeRollback(
                packets, trimIdx, packets[trimIdx].Pts);

            if (result.Rollback > TimeSpan.Zero)
                Assert.Equal(packets[result.TrimIndex].Pts, result.KeyframePts);
        }
    }

    [Fact]
    public void ResolveKeyframeRollback_EmptyPacketList_IsSafe()
    {
        var result = ClipExporter.ResolveKeyframeRollback(
            new List<EncodedPacket>(), trimIdx: 0, TimeSpan.Zero);

        Assert.Equal(0, result.TrimIndex);
        Assert.Equal(TimeSpan.Zero, result.Rollback);
    }

    /// <summary>
    /// Run de frames a 60 fps com IsKeyFrame a cada keyEvery frames. O frame 0 é sempre
    /// keyframe (todo encoder streama começando em I-frame). keyEvery &lt;= 0 produz um run
    /// sem NENHUM I-frame, para exercitar o fallback quando o stream veio corrompido.
    /// </summary>
    private static List<EncodedPacket> BuildKeyframedRun(int count, int keyEvery)
    {
        var list = new List<EncodedPacket>(count);
        for (var i = 0; i < count; i++)
        {
            list.Add(new EncodedPacket(
                new byte[] { 0x00, 0x00, 0x01, 0x65 },
                MediaType.Video,
                TimeSpan.FromSeconds(i / 60.0),
                TimeSpan.FromSeconds(1.0 / 60.0),
                isKeyFrame: keyEvery > 0 && i % keyEvery == 0));
        }
        return list;
    }
}
