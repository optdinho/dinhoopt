import { readdir } from 'node:fs/promises'

/**
 * Perfis de navegador Chromium (Chrome, Edge, Brave...) sob um `User Data`.
 *
 * Vive no próprio arquivo, e não em `cleanup.ts`, porque `scans.ts` também precisa
 * dele: com a função em `cleanup.ts` os dois módulos se importavam (scans → cleanup) e
 * o `cleanup.ts` ainda "lazy importava" os scanners, o que o rollup sinaliza como
 * import dinâmico ineficaz — o módulo já estava no bundle por causa do outro lado do
 * ciclo. Quebrar o ciclo no origem deixa os dois lados com import estático.
 */
export async function getChromiumProfiles(basePath: string): Promise<string[]> {
  const profiles = ['Default']
  try {
    const entries = await readdir(basePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('Profile ')) profiles.push(entry.name)
    }
  } catch {
    /* skip */
  }
  return profiles
}
