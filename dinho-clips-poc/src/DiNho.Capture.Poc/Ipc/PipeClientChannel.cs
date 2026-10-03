using System.Collections.Concurrent;

namespace DiNho.Capture.Poc.Ipc;

/// <summary>
/// Filas de saída de UM cliente do pipe. Antes estas filas eram globais e drenadas por
/// qualquer cliente que fizesse poll — com mais do que um cliente ligado, o primeiro a
/// fazer poll levava tudo (incluindo o resultado do <c>saveClip</c> de outro cliente).
/// </summary>
internal sealed class PipeClientChannel
{
    public Guid Id { get; } = Guid.NewGuid();

    /// <summary>Broadcasts raw dirigidos a todos os clientes (clip pronto, eventos do engine).</summary>
    public ConcurrentQueue<string> Raw { get; } = new();

    /// <summary>Respostas de comandos long-running cujo <c>reqId</c> pertence a este cliente.</summary>
    public ConcurrentQueue<string> Responses { get; } = new();
}