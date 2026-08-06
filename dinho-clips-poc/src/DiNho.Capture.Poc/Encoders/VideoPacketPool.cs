namespace DiNho.Capture.Poc.Encoders;

/// <summary>
/// Pool dedicado para os buffers de dados de vídeo (EncodedPacket.Data).
///
/// O ArrayPool.Shared default retém apenas ~16-20 arrays por bucket. Como o
/// ReplayBuffer segura dezenas de milhares de arrays (300s de captura), ao
/// evictar frames os arrays eram retornados ao pool, o bucket já estava cheio
/// e eles caíam no LOH (arrays ≥85KB), só sendo coletados em GCs gen2
/// bloqueantes — o padrão de serra no working set (~0,8MB/s de subida).
///
/// Este pool reutiliza os arrays evictados em vez de descartá-los para o LOH,
/// MAS com um teto de bytes idle (<see cref="MaxIdleBytes"/>). Acima do teto os
/// arrays voltam ao GC em vez de ficarem retidos no processo para sempre.
///
/// O ArrayPool&lt;byte&gt; customizado (256MB / 65536 por bucket) retém tudo sem
/// API de trim — o working set ficava preso no pico histórico de alocação
/// (ring ~1.1GB + spill ~1.6GB do save ≈ 4.8GB) mesmo após o buffer drenar.
/// </summary>
public static class VideoPacketPool
{
    /// <summary>
    /// Teto de bytes retidos como idle (devolvidos mas não re-rentados).
    /// Acima disso os arrays são descartados ao GC. Mutable para testes.
    /// </summary>
    internal static long MaxIdleBytes = 256L * 1024 * 1024;

    private static readonly object _sync = new();
    private static readonly Stack<byte[]> _idle = new();
    private static long _idleBytes;

    public static byte[] Rent(int minimumLength)
    {
        lock (_sync)
        {
            while (_idle.Count > 0)
            {
                var arr = _idle.Pop();
                _idleBytes -= arr.Length;
                if (arr.Length >= minimumLength)
                    return arr;
                // array pequeno demais para o tamanho pedido — descarta ao GC
            }
        }
        return new byte[minimumLength];
    }

    public static void Return(byte[] array)
    {
        lock (_sync)
        {
            if (_idleBytes + array.Length > MaxIdleBytes)
                return; // estouraria o teto — descarta ao GC
            _idle.Push(array);
            _idleBytes += array.Length;
        }
    }

    /// <summary>
    /// Esvazia o pool (estado idle). Uso exclusivo em testes — o estado estático
    /// vaza entre testes do mesmo assembly.
    /// </summary>
    internal static void ResetForTest()
    {
        lock (_sync)
        {
            _idle.Clear();
            _idleBytes = 0;
        }
    }
}
