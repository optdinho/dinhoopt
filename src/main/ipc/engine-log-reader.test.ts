import { describe, expect, it } from 'vitest'
import { createEngineLogReader } from './engine-log-reader'

// O engine C# escreve TODOS os níveis em stderr (ConsoleLogger.cs:16, writer padrão
// = Console.Error) e codifica o nível no texto ("HH:mm:ss.fff [Info   ] [Fonte] msg").
// Ao mesmo tempo faz flush de 64 linhas de uma vez (ConsoleLogger.cs:35), e um pipe
// não respeita as fronteiras de linha: um chunk chega ao fim a meio de uma linha.
//
// O log de produção de 2026-10-04 provou o estrago: 278 entradas `level:"error"`, 68
// delas fragmentos de telemetria — `"Pause=26ms (+0ms)"`, `"ue=0.6 avg / 1 max |
// codec=av1_nvenc scale=full speed=0.82x outLag=36s feedLag=14%/s"` — registados como
// erro porque não tinham `[Nível]` para ler. O nível estava lá, mas na outra metade da
// linha. Estes testes existem para que isso não volte.

describe('createEngineLogReader', () => {
  it('returns only complete lines and holds a partial tail', () => {
    const reader = createEngineLogReader('info')

    const first = reader.push('00:00:00.000 [Info   ] [A] one\n00:00:00.001 [Info   ] [A] tw')
    expect(first).toEqual([{ level: 'info', text: '00:00:00.000 [Info   ] [A] one' }])

    const second = reader.push('o\n')
    expect(second).toEqual([{ level: 'info', text: '00:00:00.001 [Info   ] [A] two' }])
  })

  it('never reports a held partial line as an error', () => {
    // O caso que produzia os 68 falsos erros: stderr, fallback 'error', e a linha
    // partida exactamente a meio de uma palavra.
    const reader = createEngineLogReader('error')

    expect(reader.push('21:00:00.000 [Info   ] [FeedTelemetry] q')).toEqual([])

    expect(reader.push('ueue=0.6 avg / 1 max | codec=av1_nvenc\n')).toEqual([
      {
        level: 'info',
        text: '21:00:00.000 [Info   ] [FeedTelemetry] queue=0.6 avg / 1 max | codec=av1_nvenc',
      },
    ])
  })

  it('reassembles a line split across three chunks', () => {
    const reader = createEngineLogReader('error')

    expect(reader.push('00:00:00.000 [Warning] [Pipeline] fra')).toEqual([])
    expect(reader.push('me dro')).toEqual([])
    expect(reader.push('pped - drop #1\n')).toEqual([
      { level: 'warning', text: '00:00:00.000 [Warning] [Pipeline] frame dropped - drop #1' },
    ])
  })

  it('flush emits a trailing partial line with the stream fallback and is idempotent', () => {
    const reader = createEngineLogReader('error')
    reader.push('fragmento sem nivel')

    expect(reader.flush()).toEqual([{ level: 'error', text: 'fragmento sem nivel' }])
    expect(reader.flush()).toEqual([])
  })

  it('keeps each stream buffer independent', () => {
    const stdout = createEngineLogReader('info')
    const stderr = createEngineLogReader('error')

    expect(stdout.push('parcial')).toEqual([])
    expect(stderr.push('00:00:00.000 [Info   ] [X] y\n')).toEqual([
      { level: 'info', text: '00:00:00.000 [Info   ] [X] y' },
    ])
    // O stdout não herdou nada do stderr, e vice-versa.
    expect(stdout.push('resto\n')).toEqual([{ level: 'info', text: 'parcialresto' }])
  })

  it('caps an unbounded partial line instead of growing forever', () => {
    const max = 1_000
    const reader = createEngineLogReader('error', { maxPendingChars: max })
    let emitted = 0

    for (let i = 0; i < 500; i++) {
      for (const line of reader.push('x'.repeat(100))) emitted += line.text.length
    }

    expect(emitted).toBeGreaterThanOrEqual(49_000)
    const tail = reader.flush()
    expect(tail).toHaveLength(1)
    const [only] = tail
    expect(only?.text.length).toBeLessThanOrEqual(max)
    // O nível das linhas forçadas é o fallback — não há `[Nível]` para ler.
    expect(only?.level).toBe('error')
  })

  it('handles CRLF without leaving a stray carriage return', () => {
    const reader = createEngineLogReader('error')

    expect(reader.push('00:00:00.000 [Info   ] [X] a\r\n00:00:00.001 [Info   ] [X] b\r\n')).toEqual([
      { level: 'info', text: '00:00:00.000 [Info   ] [X] a' },
      { level: 'info', text: '00:00:00.001 [Info   ] [X] b' },
    ])
  })

  // Regressão do log de 2026-11-10: uma sessão de 51 min produziu 446 238 linhas
  // para 36 279 mensagens distintas — 409 959 linhas repetidas (92%). O motor do
  // defeito era este: quando o chunk acabava exactamente numa fronteira de linha,
  // `pending` nunca era limpo e cada `push` voltava a emitir tudo o que já tinha
  // saído. Com o tecto de 64 KB, o efeito real era re-emitir ~64 KB de log antigo
  // a cada chunk — no log do cliente via-se a mesma linha com o mesmo timestamp
  // interno a repetir-se durante minutos.
  it('does not re-emit lines that were already emitted when a chunk ends on a separator', () => {
    const reader = createEngineLogReader('error')

    expect(reader.push('00:00:00.000 [Info   ] [A] one\n00:00:00.001 [Info   ] [A] two\n')).toEqual([
      { level: 'info', text: '00:00:00.000 [Info   ] [A] one' },
      { level: 'info', text: '00:00:00.001 [Info   ] [A] two' },
    ])

    expect(reader.push('00:00:00.002 [Info   ] [A] three\n')).toEqual([
      { level: 'info', text: '00:00:00.002 [Info   ] [A] three' },
    ])
  })

  it('emits each line exactly once across many separator-aligned chunks', () => {
    const reader = createEngineLogReader('error')
    const seen: string[] = []

    for (let i = 0; i < 50; i++) {
      // Cada chunk acaba em \n — era o caso que re-emitia o buffer inteiro.
      seen.push(...reader.push(`00:00:00.${String(i).padStart(3, '0')} [Debug  ] [X] line ${i}\n`).map((l) => l.text))
    }

    expect(seen).toHaveLength(50)
    expect(new Set(seen).size).toBe(50)
  })

  it('handles a multi-byte char split across chunks', () => {
    const reader = createEngineLogReader('error')
    const full = Buffer.from('00:00:00.000 [Info   ] [X] ação\n', 'utf8')
    // 'ç' ocupa 2 bytes: cortar entre eles parte o carácter ao meio.
    const cut = full.indexOf(0xc3) + 1
    expect(cut).toBeGreaterThan(0)

    expect(reader.push(full.subarray(0, cut))).toEqual([])
    expect(reader.push(full.subarray(cut))).toEqual([{ level: 'info', text: '00:00:00.000 [Info   ] [X] ação' }])
  })
})
