using System;

namespace DiNho.Capture.Poc;

/// <summary>
/// Janela de aquecimento do pipeline. Nos primeiros <see cref="GraceMs"/> ms o encoder
/// ffmpeg/AAC ainda está a drenar o cold-start: o WGC já entrega frames enquanto o stdin
/// enche e o cap local rejeita. Os transientes daí (frame drop, overflow da fila do
/// writer, AAC ainda sem frame) são esperados e não indicam defeito — por isso são
/// rebaixados para Debug com o rótulo <c>[startup]</c>. Fora da janela, os mesmos eventos
/// voltam a ser WARN, para não esconder uma regressão real.
///
/// <para>
/// Evidência (sessão real 2026-10-02, 4 h): TODOS os transientes de arranque ocorreram
/// em ≤ 0,5 s do início da pipeline (<c>drop #1</c>/<c>#25</c> em 16:17:22,6–23,1,
/// overflow total 1 em 16:17:22,9, AAC sem frame nos packets #4/#5); depois, zero
/// durante as 4 h. Ver Candidato 5 do plano de investigação.
/// </para>
/// </summary>
internal static class StartupWarmup
{
    /// <summary>Janela de carência pós-arranque (2 s).</summary>
    internal const int GraceMs = 2000;

    /// <summary>Estamos dentro da janela de aquecimento? Elapsed negativo não conta.</summary>
    internal static bool IsWarmup(TimeSpan sinceStart)
        => sinceStart >= TimeSpan.Zero && sinceStart < TimeSpan.FromMilliseconds(GraceMs);
}
