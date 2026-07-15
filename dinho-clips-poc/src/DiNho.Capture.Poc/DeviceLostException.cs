namespace DiNho.Capture.Poc;

/// <summary>
/// Exceção lançada quando o dispositivo D3D11 é removido (TDR, driver crash, sleep/wake).
/// Segue o padrão documentado pela Microsoft: DXGI_ERROR_DEVICE_REMOVED / DXGI_ERROR_DEVICE_RESET.
/// </summary>
public sealed class DeviceLostException : Exception
{
    public DeviceLostException() : base("D3D11 device lost (DXGI_ERROR_DEVICE_REMOVED or DXGI_ERROR_DEVICE_RESET)") { }
    public DeviceLostException(string message) : base(message) { }
    public DeviceLostException(string message, Exception inner) : base(message, inner) { }
}
