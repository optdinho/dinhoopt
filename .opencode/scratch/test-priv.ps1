$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PrivTest {
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out long lpLuid);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TOKEN_PRIVILEGES NewState, uint BufferLength, IntPtr PreviousState, IntPtr ReturnLength);
  [DllImport("kernel32.dll")]
  public static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern int GetLastError();
  [StructLayout(LayoutKind.Sequential)]
  public struct LUID { public uint LowPart; public int HighPart; }
  [StructLayout(LayoutKind.Sequential)]
  public struct TOKEN_PRIVILEGES { public uint PrivilegeCount; public LUID Luid; public uint Attributes; }
  public static string EnableAndTest() {
    IntPtr hToken;
    if (!OpenProcessToken(GetCurrentProcess(), 0x0028, out hToken))
      return "FAIL OpenProcessToken: " + Marshal.GetLastWin32Error().ToString();
    long luid;
    if (!LookupPrivilegeValue(null, "SeIncreaseQuotaPrivilege", out luid))
      return "FAIL LookupPrivilegeValue: " + Marshal.GetLastWin32Error().ToString();
    var tp = new TOKEN_PRIVILEGES{PrivilegeCount=1,Luid=new LUID{LowPart=(uint)(luid&0xFFFFFFFF),HighPart=(int)(luid>>32)},Attributes=2u};
    bool ok = AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
    int gle = GetLastError();
    if (!ok) return "FAIL AdjustTokenPrivileges: " + gle.ToString();
    if (gle == 0) return "OK - privilege enabled (ERROR_SUCCESS)";
    if (gle == 1300) return "PARTIAL - ERROR_NOT_ALL_ASSIGNED (1300)";
    return "OK Adjust returned true, GLE=" + gle;
  }
}
'@
$result = [PrivTest]::EnableAndTest()
Write-Output "Result: $result"
