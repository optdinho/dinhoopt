using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Hotkeys;

public enum PttMode
{
    Off,
    Hold,
    Toggle
}

public sealed class PushToTalkManager : IDisposable
{
    private readonly HotkeyManager _hotkeyManager;
    private readonly HashSet<int> _pttKeys = new();
    private bool _micActive;
    private PttMode _mode = PttMode.Hold;

    public bool MicActive => _micActive;
    public PttMode Mode { get => _mode; set => _mode = value; }

    public event Action<bool>? OnMicStateChanged;

    public PushToTalkManager(HotkeyManager hotkeyManager)
    {
        _hotkeyManager = hotkeyManager;
        _hotkeyManager.OnRawKeyEvent += OnRawKey;
    }

    public void AddPttKey(VirtualKey key)
    {
        _pttKeys.Add((int)key);
    }

    public void RemovePttKey(VirtualKey key)
    {
        _pttKeys.Remove((int)key);
    }

    public void ClearKeys()
    {
        _pttKeys.Clear();
    }

    private void OnRawKey(int vkCode, bool isKeyDown)
    {
        var isPtt = _pttKeys.Contains(vkCode);
        Log.D("PushToTalk", $"vk=0x{vkCode:X2} down={isKeyDown} ptt={isPtt} pttKeys=[{string.Join(",", _pttKeys)}]");

        if (!isPtt) return;
        if (_mode == PttMode.Off) return;

        if (_mode == PttMode.Hold)
        {
            _micActive = isKeyDown;
            Log.D("PushToTalk", $"Hold -> micActive={_micActive}");
            OnMicStateChanged?.Invoke(_micActive);
        }
        else if (_mode == PttMode.Toggle && isKeyDown)
        {
            _micActive = !_micActive;
            Log.D("PushToTalk", $"Toggle -> micActive={_micActive}");
            OnMicStateChanged?.Invoke(_micActive);
        }
    }

    public void Dispose()
    {
        _hotkeyManager.OnRawKeyEvent -= OnRawKey;
    }
}
