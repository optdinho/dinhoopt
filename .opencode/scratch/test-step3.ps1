Add-Type -TypeDefinition @'
  using System;
  using System.Runtime.InteropServices;
  public class MemUtils {
    [DllImport("kernel32.dll")]
    public static extern bool SetProcessWorkingSetSize(IntPtr hProcess, int dwMinimumWorkingSetSize, int dwMaximumWorkingSetSize);
  }
'@
Get-Process | Where-Object { $_.Id -ne $pid } | ForEach-Object {
  try { [MemUtils]::SetProcessWorkingSetSize($_.Handle, -1, -1) } catch {}
}
$size = 300 * 1024 * 1024
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
for ($i = 0; $i -lt $size; $i += 65536) {
  [System.Runtime.InteropServices.Marshal]::WriteByte([IntPtr]::Add($ptr, $i), 1)
}
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
[System.GC]::Collect()
[System.GC]::WaitForPendingFinalizers()
Write-Output "STEP3 OK"
