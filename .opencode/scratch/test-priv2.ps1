$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PrivTest2 {
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr h, uint a, out IntPtr t);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool LookupPrivilegeValue(string s, string n, out long l);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool AdjustTokenPrivileges(IntPtr t, bool d, ref TP s, uint l, IntPtr p, IntPtr r);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool GetTokenInformation(IntPtr h, int cls, IntPtr buf, uint sz, out uint retSz);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();

  [StructLayout(LayoutKind.Sequential)]
  struct LUID { public uint Lo; public int Hi; }
  [StructLayout(LayoutKind.Sequential)]
  struct LUID_AND_ATTRIBUTES { public LUID Luid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)]
  struct TP { public uint Count; public LUID_AND_ATTRIBUTES Priv; }

  public static int TryEnableAndCall() {
    // Enable SeIncreaseQuotaPrivilege
    IntPtr hToken;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0028, out hToken))
      return -1;
    long luid;
    if (!LookupPrivilegeValue(null, "SeIncreaseQuotaPrivilege", out luid))
      return -2;
    var tp = new TP { Count = 1, Priv = new LUID_AND_ATTRIBUTES { Luid = new LUID { Lo = (uint)(luid & 0xFFFFFFFF), Hi = (int)(luid >> 32) }, Attributes = 2 } };
    if (!AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero))
      return -3;

    // Verify with GetTokenInformation
    uint sz = 0;
    GetTokenInformation(hToken, 11, IntPtr.Zero, 0, out sz);
    var buf = Marshal.AllocHGlobal((int)sz);
    if (GetTokenInformation(hToken, 11, buf, sz, out sz)) {
      int count = Marshal.ReadInt32(buf);
      for (int i = 0; i < count; i++) {
        int offset = 4 + i * 12;
        long privLuid = Marshal.ReadInt64(buf, offset);
        uint attrs = Marshal.ReadUInt32(buf, offset + 8);
        if (privLuid == luid) {
          Marshal.FreeHGlobal(buf);
          return (int)attrs; // returns privilege attributes (0=disabled, 2=enabled)
        }
      }
    }
    Marshal.FreeHGlobal(buf);
    return -4; // privilege not found in token
  }
}
'@
$result = [PrivTest2]::TryEnableAndCall()
if ($result -eq 0) { Write-Output "Privilege state: DISABLED (0)" }
elseif ($result -eq 2) { Write-Output "Privilege state: ENABLED (2)" }
elseif ($result -eq -1) { Write-Output "FAIL OpenProcessToken" }
elseif ($result -eq -2) { Write-Output "FAIL LookupPrivilegeValue" }
elseif ($result -eq -3) { Write-Output "FAIL AdjustTokenPrivileges" }
elseif ($result -eq -4) { Write-Output "Privilege not found in token" }
else { Write-Output "Unexpected result: $result" }
