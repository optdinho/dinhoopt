$ErrorActionPreference = 'Stop'
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class FullTest3 {
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr h, uint a, out IntPtr t);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool LookupPrivilegeValue(string s, string n, out long l);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool AdjustTokenPrivileges(IntPtr t, bool d, ref TP s, uint l, IntPtr p, IntPtr r);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();
  [DllImport("ntdll.dll", SetLastError = true)]
  static extern int NtSetSystemInformation(int c, IntPtr b, int l);
  struct LUID { public uint Lo; public int Hi; }
  struct TP { public uint C; public LUID L; public uint A; }

  public static string Run() {
    IntPtr hToken;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0028, out hToken))
      return "FAIL OpenProcessToken: " + Marshal.GetLastWin32Error();
    long luid;
    if (!LookupPrivilegeValue(null, "SeIncreaseQuotaPrivilege", out luid))
      return "FAIL LookupPrivilegeValue: " + Marshal.GetLastWin32Error();
    var tp = new TP { C = 1, L = new LUID { Lo = (uint)(luid & 0xFFFFFFFF), Hi = (int)(luid >> 32) }, A = 2 };
    bool adjOk = AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
    int gle = Marshal.GetLastWin32Error();
    if (!adjOk) return "FAIL AdjustTokenPrivileges: " + gle;
    if (gle == 1300) return "FAIL AdjustTokenPrivileges: ERROR_NOT_ALL_ASSIGNED";
    var ptr = Marshal.AllocHGlobal(4);
    Marshal.WriteInt32(ptr, 1);
    int result = NtSetSystemInformation(0x50, ptr, 4);
    Marshal.FreeHGlobal(ptr);
    if (result == 0) return "SUCCESS";
    return "FAIL NtSetSystemInformation: 0x" + result.ToString("X8");
  }
}
'@
$r = [FullTest3]::Run()
Write-Output "Result: $r"
} catch { throw "TestFull3: $_" }
