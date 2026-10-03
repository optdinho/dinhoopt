using System.Collections.Concurrent;

namespace DiNho.Capture.Poc.Ipc;

/// <summary>
/// Roteia a resposta de um comando long-running (<c>saveClip</c>, <c>trimClip</c>,
/// <c>mergeClips</c>) para o cliente que o pediu, usando o <c>reqId</c> do envelope.
///
/// Sem isto, a fila de resultados é global e o cliente que fizer poll primeiro rouba o
/// resultado dos outros. Clientes que não enviam <c>reqId</c> (o Electron não envia) caem
/// na fila órfã, preservando exactamente o comportamento anterior.
/// </summary>
internal sealed class ClientResponseRouter
{
    private readonly ConcurrentDictionary<string, Guid> _ownerByRequestId = new(StringComparer.Ordinal);

    public void Register(string? requestId, Guid clientId)
    {
        if (!string.IsNullOrEmpty(requestId))
            _ownerByRequestId[requestId] = clientId;
    }

    /// <summary>Resolve e DESREGISTA o reqId: cada pedido tem uma só resposta.</summary>
    public bool TryResolve(string? requestId, out Guid clientId)
    {
        clientId = Guid.Empty;
        if (string.IsNullOrEmpty(requestId))
            return false;
        return _ownerByRequestId.TryRemove(requestId, out clientId);
    }

    /// <summary>Remove todas as entradas que apontam para um cliente que se desligou.</summary>
    public int ForgetClient(Guid clientId)
    {
        var stale = _ownerByRequestId.Where(kv => kv.Value == clientId).Select(kv => kv.Key).ToArray();
        foreach (var key in stale)
            _ownerByRequestId.TryRemove(key, out _);
        return stale.Length;
    }

    internal int Count => _ownerByRequestId.Count;
}