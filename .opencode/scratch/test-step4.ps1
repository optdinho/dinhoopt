Add-Type -TypeDefinition @'
  using System;
  using System.Runtime.InteropServices;
  public class CacheUtils {
    [DllImport("kernel32.dll")]
    public static extern bool SetProcessWorkingSetSize(IntPtr hProcess, int dwMinimumWorkingSetSize, int dwMaximumWorkingSetSize);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
  }
'@
$hProcess = [CacheUtils]::OpenProcess(0x0100, $false, 4)
Write-Output "OpenProcess(PID 4) handle: $hProcess"
if ($hProcess -ne [IntPtr]::Zero) {
  $ok = [CacheUtils]::SetProcessWorkingSetSize($hProcess, -1, -1)
  Write-Output "SetProcessWorkingSetSize on System: $ok"
  [CacheUtils]::CloseHandle($hProcess)
}
$size = 500 * 1024 * 1024
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
for ($i = 0; $i -lt $size; $i += 65536) {
  [System.Runtime.InteropServices.Marshal]::WriteByte([IntPtr]::Add($ptr, $i), 1)
}
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
Write-Output "STEP4 OK"
