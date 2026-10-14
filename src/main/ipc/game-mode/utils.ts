import { execFileAsync, psEncodedArgs } from '../../services/exec-utf8'

export async function ps(script: string, timeout = 15000): Promise<string> {
  const { stdout } = await execFileAsync('powershell.exe', psEncodedArgs(script), {
    timeout,
    windowsHide: true,
  })
  return String(stdout).trim()
}
