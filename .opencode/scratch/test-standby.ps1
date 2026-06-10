$ErrorActionPreference = 'Stop'
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MemHelper {
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out long lpLuid);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TOKEN_PRIVILEGES NewState, uint BufferLength, IntPtr PreviousState, IntPtr ReturnLength);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();
  [DllImport("ntdll.dll", SetLastError = true)]
  static extern int NtSetSystemInformation(int SystemInformationClass, IntPtr SystemInformation, int SystemInformationLength);
  [StructLayout(LayoutKind.Sequential)]
  struct LUID { public uint LowPart; public int HighPart; }
  [StructLayout(LayoutKind.Sequential)]
  struct TOKEN_PRIVILEGES { public uint PrivilegeCount; public LUID Luid; public uint Attributes; }
  public static void ClearStandby() {
    IntPtr hToken;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0028, out hToken))
      throw new InvalidOperationException("OpenProcessToken failed");
    long luid;
    if (!LookupPrivilegeValue(null, "SeIncreaseQuotaPrivilege", out luid))
      throw new InvalidOperationException("LookupPrivilegeValue failed");
    var tp = new TOKEN_PRIVILEGES{PrivilegeCount=1,Luid=new LUID{LowPart=(uint)(luid&0xFFFFFFFF),HighPart=(int)(luid>>32)},Attributes=2u};
    AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
    var ptr = Marshal.AllocHGlobal(4);
    Marshal.WriteInt32(ptr, 1);
    int result = NtSetSystemInformation(0x50, ptr, 4);
    Marshal.FreeHGlobal(ptr);
    if (result != 0) throw new InvalidOperationException("NtSetSystemInformation returned 0x"+result.ToString("X8"));
  }
}
'@
[MemHelper]::ClearStandby()
Write-Output "SUCCESS"
} catch { throw "StandbyClear: $_" }
