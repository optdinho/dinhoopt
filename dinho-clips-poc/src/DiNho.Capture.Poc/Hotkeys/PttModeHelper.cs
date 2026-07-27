namespace DiNho.Capture.Poc.Hotkeys;

internal static class PttModeHelper
{
    internal static string Normalize(string mode)
    {
        return mode?.ToLowerInvariant() switch
        {
            "hold" => "Hold",
            "toggle" => "Toggle",
            _ => "Off",
        };
    }
}
