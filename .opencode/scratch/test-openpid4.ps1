Add-Type -TypeDefinition @'
  using System;
  using System.Runtime.InteropServices;
  public class Test {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
    public static string TryOpen(int access, string label) {
      IntPtr h = OpenProcess((uint)access, false, 4);
      int err = Marshal.GetLastWin32Error();
      if (h != IntPtr.Zero) { CloseHandle(h); return label + ": OK"; }
      return label + ": FAIL err=" + err;
    }
  }
'@
Write-Output "Testing OpenProcess on PID 4..."
Write-Output ([Test]::TryOpen(0x0400, "PROCESS_QUERY_INFO"))
Write-Output ([Test]::TryOpen(0x0010, "PROCESS_VM_READ"))
Write-Output ([Test]::TryOpen(0x0100, "PROCESS_SET_QUOTA"))
Write-Output ([Test]::TryOpen(0x1FFFFF, "PROCESS_ALL_ACCESS"))
