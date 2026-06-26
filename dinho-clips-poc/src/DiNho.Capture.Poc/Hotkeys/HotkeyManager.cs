using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using DiNho.Capture.Poc.Config;

namespace DiNho.Capture.Poc.Hotkeys;

public enum HotkeyAction
{
    SaveClip,
    ToggleCapture,
    ToggleMic,
}

public sealed class HotkeyPressedEventArgs : EventArgs
{
    public HotkeyAction Action { get; init; }
    public int? ReplayDurationSeconds { get; init; }
    public HotkeyBinding Binding { get; init; } = null!;
}

public sealed class HotkeyManager : IDisposable
{
    private readonly List<HotkeyBinding> _bindings = new();
    private readonly HashSet<int> _keysDown = new();
    private WindowsHookDelegate? _hookDelegate;
    private WindowsHookDelegate? _mouseHookDelegate;
    private IntPtr _hookId = IntPtr.Zero;
    private IntPtr _mouseHookId = IntPtr.Zero;
    private Thread? _hookThread;
    private bool _disposed;
    private readonly object _lock = new();

    public event Action<HotkeyPressedEventArgs>? OnHotkeyPressed;
    public event Action<int, bool>? OnRawKeyEvent;

    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    private const int VK_LMENU = 0xA4;
    private const int VK_RMENU = 0xA5;
    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;
    private const int VK_LSHIFT = 0xA0;
    private const int VK_RSHIFT = 0xA1;
    private const int WM_XBUTTONDOWN = 0x020B;
    private const int WM_XBUTTONUP = 0x020C;
    private const int WM_NCXBUTTONDOWN = 0x00AB;
    private const int WM_NCXBUTTONUP = 0x00AC;
    private const int XBUTTON1 = 0x0001;
    private const int XBUTTON2 = 0x0002;
    private const int VK_XBUTTON1 = 0x05;
    private const int VK_XBUTTON2 = 0x06;

    public void UpdateBindings(List<HotkeyBinding> bindings)
    {
        lock (_lock)
        {
            _bindings.Clear();
            _bindings.AddRange(bindings);
            Console.WriteLine($"[HotkeyManager] UpdateBindings: {bindings.Count} bindings");
            foreach (var b in _bindings)
            {
                var mods = b.Modifiers.Count > 0 ? $"+0x{string.Join("+0x", b.Modifiers.Select(m => m.ToString("X2")))}" : "";
                Console.WriteLine($"  Vk=0x{b.Vk:X2}{mods} Action={b.Action} Enabled={b.Enabled}");
            }
        }
    }

    public void Start()
    {
        if (_hookId != IntPtr.Zero) return;

        _hookThread = new Thread(() =>
        {
            _hookDelegate = KeyboardHookCallback;
            _mouseHookDelegate = MouseHookCallback;
            using var process = Process.GetCurrentProcess();
            using var module = process.MainModule;
            if (module == null) return;
            var moduleHandle = GetModuleHandle(module.ModuleName);
            _hookId = SetWindowsHookEx(WH_KEYBOARD_LL, _hookDelegate, moduleHandle, 0);
            Console.WriteLine($"[HotkeyManager] WH_KEYBOARD_LL hook: {(long)_hookId:X} (0=falhou)");
            _mouseHookId = SetWindowsHookEx(WH_MOUSE_LL, _mouseHookDelegate, moduleHandle, 0);
            Console.WriteLine($"[HotkeyManager] WH_MOUSE_LL hook: {(long)_mouseHookId:X} (0=falhou)");

            while (!_disposed)
            {
                if (GetMessage(out var msg, IntPtr.Zero, 0, 0) == -1)
                    break;
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            if (_hookId != IntPtr.Zero)
                UnhookWindowsHookEx(_hookId);
            if (_mouseHookId != IntPtr.Zero)
                UnhookWindowsHookEx(_mouseHookId);
        })
        {
            Name = "HotkeyHook",
            IsBackground = true
        };
        _hookThread.Start();
    }

    public void Stop()
    {
        _disposed = true;
        _hookThread?.Join(1000);
        _hookThread = null;
    }

    private int _kbdCounter;
    private IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (nCode >= 0)
            {
                var vkCode = Marshal.ReadInt32(lParam);
                var isKeyDown = wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN;
                var isKeyUp = wParam == WM_KEYUP || wParam == WM_SYSKEYUP;

                // Diagnóstico: loga CapsLock (0x14) sempre, e toda tecla a cada 50 eventos
                _kbdCounter++;
                if (vkCode == 0x14 || (_kbdCounter % 50 == 0))
                    Console.WriteLine($"[KbdHook] vk=0x{vkCode:X2} down={isKeyDown} up={isKeyUp} nCode={nCode}");

                if (isKeyDown)
                {
                    if (_keysDown.Contains(vkCode))
                        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);

                    _keysDown.Add(vkCode);
                    var generic = MapToGenericVk(vkCode);
                    if (generic != null)
                        _keysDown.Add(generic.Value);
                    OnRawKeyEvent?.Invoke(vkCode, true);
                    MatchAndFireHotkey(vkCode);
                }
                else if (isKeyUp)
                {
                    _keysDown.Remove(vkCode);
                    var generic = MapToGenericVk(vkCode);
                    if (generic != null)
                        _keysDown.Remove(generic.Value);
                    OnRawKeyEvent?.Invoke(vkCode, false);
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[HotkeyManager] Erro no callback: {ex.GetType().Name}: {ex.Message}");
        }

        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (nCode < 0) return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);

            var isDown = wParam == WM_XBUTTONDOWN || wParam == WM_NCXBUTTONDOWN;
            var isUp = wParam == WM_XBUTTONUP || wParam == WM_NCXBUTTONUP;
            if (!isDown && !isUp) return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);

            var hookStruct = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
            var xButton = (int)(hookStruct.mouseData >> 16);
            int vkCode = xButton switch
            {
                XBUTTON1 => VK_XBUTTON1,
                XBUTTON2 => VK_XBUTTON2,
                _ => 0,
            };
            if (vkCode == 0) return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);

            if (isDown)
            {
                if (_keysDown.Contains(vkCode))
                    return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
                _keysDown.Add(vkCode);
                OnRawKeyEvent?.Invoke(vkCode, true);
                MatchAndFireHotkey(vkCode);
            }
            else
            {
                _keysDown.Remove(vkCode);
                OnRawKeyEvent?.Invoke(vkCode, false);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[HotkeyManager] Erro no callback mouse: {ex.GetType().Name}: {ex.Message}");
        }

        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private void MatchAndFireHotkey(int vkCode)
    {
        lock (_lock)
        {
            Console.WriteLine($"[HotkeyManager] MatchAndFireHotkey: vk=0x{vkCode:X2} bindings={_bindings.Count}");
            foreach (var binding in _bindings)
            {
                Console.WriteLine($"  check: Vk=0x{binding.Vk:X2} Mods=[{string.Join(",", binding.Modifiers)}] Enabled={binding.Enabled}");
                if (!binding.Enabled) continue;
                if (binding.Vk != vkCode) continue;

                if (binding.Modifiers.Count > 0 && !ModifiersPressed(binding.Modifiers))
                {
                    Console.WriteLine($"  mods NOT pressed");
                    continue;
                }

                if (!Enum.TryParse<HotkeyAction>(binding.Action, ignoreCase: true, out var action))
                {
                    Console.WriteLine($"  parse action FAILED: '{binding.Action}'");
                    continue;
                }

                Console.WriteLine($"  FIRED! Action={action}");
                OnHotkeyPressed?.Invoke(new HotkeyPressedEventArgs
                {
                    Action = action,
                    ReplayDurationSeconds = binding.ReplayDurationSeconds,
                    Binding = binding,
                });
                break;
            }
        }
    }

    private static int? MapToGenericVk(int vk)
    {
        return vk switch
        {
            VK_LMENU or VK_RMENU => 0x12,
            VK_LCONTROL or VK_RCONTROL => 0x11,
            VK_LSHIFT or VK_RSHIFT => 0x10,
            _ => null,
        };
    }

    private bool ModifiersPressed(List<int> modVks)
    {
        foreach (var mod in modVks)
        {
            if (!_keysDown.Contains(mod))
                return false;
        }
        return true;
    }

    private delegate IntPtr WindowsHookDelegate(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, WindowsHookDelegate lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT
    {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    public void Dispose()
    {
        Stop();
    }
}

public enum VirtualKey : int
{
    VK_XBUTTON1 = 0x05,
    VK_XBUTTON2 = 0x06,
    VK_F1 = 0x70,
    VK_F2 = 0x71,
    VK_F3 = 0x72,
    VK_F4 = 0x73,
    VK_F5 = 0x74,
    VK_F6 = 0x75,
    VK_F7 = 0x76,
    VK_F8 = 0x77,
    VK_F9 = 0x78,
    VK_F10 = 0x79,
    VK_F11 = 0x7A,
    VK_F12 = 0x7B,
    VK_CAPITAL = 0x14,
    VK_CONTROL = 0x11,
    VK_SHIFT = 0x10,
    VK_MENU = 0x12,
}
