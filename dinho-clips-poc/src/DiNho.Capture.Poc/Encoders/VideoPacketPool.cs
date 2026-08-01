using System.Buffers;

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
/// Este pool usa buckets grandes o suficiente para reutilizar os arrays
/// evictados em vez de descartá-los para o LOH.
/// </summary>
public static class VideoPacketPool
{
    private const int MaxArrayLength = 256 * 1024 * 1024;
    private const int MaxArraysPerBucket = 65536;

    private static readonly ArrayPool<byte> _pool =
        ArrayPool<byte>.Create(MaxArrayLength, MaxArraysPerBucket);

    public static byte[] Rent(int minimumLength) => _pool.Rent(minimumLength);

    public static void Return(byte[] array) => _pool.Return(array);
}
