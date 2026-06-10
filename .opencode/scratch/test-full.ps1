$ErrorActionPreference = 'Stop'
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class FullTest {
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
  struct LUID_AND_ATTRIBUTES { public LUID L; public uint A; }
  struct TP { public uint C; public LUID_AND_ATTRIBUTES P; }

  public static void Run() {
    IntPtr hToken;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0028, out hToken))
      throw new Exception("OpenProcessToken failed: " + Marshal.GetLastWin32Error());
    long luid;
    if (!LookupPrivilegeValue(null, "SeIncreaseQuotaPrivilege", out luid))
      throw new Exception("LookupPrivilegeValue failed: " + Marshal.GetLastWin32Error());
    var tp = new TP { C = 1, P = new LUID_AND_ATTRIBUTES { L = new LUID { Lo = (uint)(luid & 0xFFFFFFFF), Hi = (int)(luid >> 32) }, A = 2 } };
    if (!AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero))
      throw new Exception("AdjustTokenPrivileges failed: " + Marshal.GetLastWin32Error());
    int gle = Marshal.GetLastWin32Error();
    if (gle == 1300) throw new Exception("AdjustTokenPrivileges: ERROR_NOT_ALL_ASSIGNED");
    var ptr = Marshal.AllocHGlobal(4);
    Marshal.WriteInt32(ptr, 1);
    int result = NtSetSystemInformation(0x50, ptr, 4);
    Marshal.FreeHGlobal(ptr);
    if (result != 0) throw new Exception("NtSetSystemInformation returned 0x" + result.ToString("X8"));
    // Try alternative value 3 (ClearAll)
    ptr = Marshal.AllocHGlobal(4);
    Marshal.WriteInt32(ptr, 3);
    result = NtSetSystemInformation(0x50, ptr, 4);
    Marshal.FreeHGlobal(ptr);
    if (result != 0 && result != 0xC0000061) throw new Exception("NtSetSystemInformation(3) returned 0x" + result.ToString("X8"));
  }
}
'@
[FullTest]::Run()
Write-Output "SUCCESS"
} catch { throw "TestFull: $_" }
