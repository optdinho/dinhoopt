// Leitor de linhas do stdout/stderr do engine C#.
//
// O engine escreve TODOS os níveis em stderr: `ConsoleLogger` usa `Console.Error` como writer
// padrão (ConsoleLogger.cs:16) e codifica o nível no próprio texto
// ("HH:mm:ss.fff [Info   ] [Fonte] msg"). O código anterior prefixava stderr inteiro como
// [ENGINE:ERR] e logava tudo como `warning` — então uma linha [Info] chegava ao log do app
// como erro, o canal de erro virava ruído e o log de produção mostrou exatamente isso
// ("[ENGINE:ERR] ... [Info   ] [HotkeyManager] ...").
//
// Não trocamos o lado C#: ele segue a convenção "dados em stdout, logs em stderr", que é o que
// permite ler a saída dos probes (`--probe-*`) sem filtrar log no meio. O nível já vem na linha,
// então basta honrá-lo aqui.
//
// A segunda metade do problema é que o nível vinha *metade* da linha. O `ConsoleLogger` faz flush
// de 64 linhas de uma vez (ConsoleLogger.cs:35) e um pipe não respeita fronteiras de linha: um
// chunk chega ao fim a meio de uma linha. O log de produção de 2026-10-04 mediu o estrago em duas
// metades complementares, e é isso que o reader elimina:
//
//   - cauda sem prefixo: 68 entradas `level:"error"` que eram na verdade o fim de uma linha de
//     telemetria ("Pause=26ms (+0ms)", "e=0.1 avg / 1 max | codec=av1_nvenc..."). Sem `[Nível]`
//     para ler, caíam no fallback do stream.
//   - cabeça com prefixo: 7 heads truncadas a meio de uma palavra em 1168 linhas do formato novo
//     ("| queu"), com o nível certo mas o texto cortado — pelo que não contavam como erro e
//     escapavam a qualquer contagem por nível.
//
// As duas metades da mesma linha estão no ficheiro como entradas separadas, portanto a linha
// real nunca foi registada: uma linha partida virava dois registos, um deles falso erro. Este
// reader retém a cauda incompleta e só emite linhas montadas.

export type EngineLogLevel = 'debug' | 'info' | 'warning' | 'error'

export interface EngineLogLine {
  level: EngineLogLevel
  text: string
}

const ENGINE_LEVEL_PREFIX: Record<EngineLogLevel, string> = {
  debug: '[ENGINE:DBG]',
  info: '[ENGINE]',
  warning: '[ENGINE:WARN]',
  error: '[ENGINE:ERR]',
}

const ENGINE_LINE_RE = /^(?:\d{2}:\d{2}:\d{2}\.\d{3} )?\[(\w+)\s*\]/

// \r\n, \r e \n são todos separadores de linha. O engine é Windows e escreve \r\n, mas o log
// também passa por ferramentas que normalizam para \n — e um \r deixado no fim do texto
// sujaria a linha no JSONL.
const LINE_SEPARATOR_RE = /\r\n|\r|\n/
const TRAILING_SEPARATOR_RE = /\r\n$|\n$|\r$/

//Uma linha de log sem separador é um stream corrompido ou um probe que escreve sem
// newline. 64 KB é muito para uma linha de log (a maior do log real é ~200 chars) e
// pequeno o suficiente para o buffer não crescer sem limite.
const DEFAULT_MAX_PENDING_CHARS = 64 * 1024

/**
 * Classifica linhas JÁ COMPLETAS. Não sabe nada de chunks: quem decide o que é uma linha
 * completa é o `createEngineLogReader`.
 */
export function classifyEngineLines(chunk: string, fallback: EngineLogLevel): EngineLogLine[] {
  return chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const matched = ENGINE_LINE_RE.exec(line)?.[1]?.toLowerCase() as EngineLogLevel | undefined
      const level = matched && matched in ENGINE_LEVEL_PREFIX ? matched : fallback
      return { level, text: line }
    })
}

export function engineLogPrefix(level: EngineLogLevel): string {
  return ENGINE_LEVEL_PREFIX[level]
}

export interface EngineLogReader {
  /** Acumula o chunk e devolve só as linhas que ficou completas. */
  push(chunk: Buffer | string): EngineLogLine[]
  /** Devolve o que estiver retido (com o nível do stream) e esvazia. Idempotente. */
  flush(): EngineLogLine[]
}

/**
 * Um reader por stream e por processo. O estado (a cauda incompleta) é deliberadamente
 * local à instância: um reader module-level vazaria a linha partida de um engine para o
 * seguinte, e o `startEngine` faz `taskkill` + `spawn` a cada arranque.
 *
 * O `fallback` é o nível para linha sem `[Nível]` legível. stderr usa 'error' por convenção
 * do engine (rebaixar esconderia erro real); stdout usa 'info' porque stdout é o canal de
 * dados, incluindo a saída dos probes.
 */
export function createEngineLogReader(fallback: EngineLogLevel, opts?: { maxPendingChars?: number }): EngineLogReader {
  const maxPendingChars = opts?.maxPendingChars ?? DEFAULT_MAX_PENDING_CHARS
  const decoder = new TextDecoder('utf-8')
  let pending = ''

  const take = (): EngineLogLine[] => {
    const parts = pending.split(LINE_SEPARATOR_RE)
    // Se o texto Terminou com separador o último elemento é '' e nada fica pendente.
    if (TRAILING_SEPARATOR_RE.test(pending)) parts.pop()
    else pending = parts.pop() ?? ''
    return classifyEngineLines(parts.join('\n'), fallback)
  }

  return {
    push(chunk) {
      // `stream: true` mantém o estado do decoder entre chunks — sem isto um carácter
      // multibyte partido pelo pipe sairia com o byte de substituição U+FFFD.
      pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })

      const lines = take()
      if (pending.length <= maxPendingChars) return lines

      // Stream sem separadores: corta o que está a mais em vez de crescer para sempre. O
      // nível é o fallback porque este excerto, por definição, não tem [Nível] para ler.
      const keep = pending.length - maxPendingChars
      const forced = pending.slice(0, keep)
      pending = pending.slice(keep)
      return [...classifyEngineLines(forced, fallback), ...lines]
    },

    flush() {
      // Drain do decoder: um multibyte partido no último chunk ainda estava por sair.
      pending += decoder.decode()
      if (pending.trim().length === 0) {
        pending = ''
        return []
      }
      const line = classifyEngineLines(pending, fallback)
      pending = ''
      return line
    },
  }
}
