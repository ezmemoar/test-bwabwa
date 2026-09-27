import type { H3Event } from 'h3'

type Level = 'debug' | 'info' | 'warn' | 'error'

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const isDev = import.meta.dev

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < order[useConfig().logLevel]) return
  if (isDev) {
    const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : ''
    ;(level === 'error' ? console.error : console.log)(`[${level}] ${msg}${extra}`)
    return
  }
  // One JSON object per line: what log shippers (Fly, Railway, Datadog, Loki) expect.
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
}

/**
 * One access-log line per API request. Called from the `afterResponse` hook for successful requests and from
 * the error handler for failed ones (Nitro skips `afterResponse` when a handler throws).
 */
export function logRequest(event: H3Event, status: number, extra?: Record<string, unknown>) {
  if (!event.path.startsWith('/api/')) return
  const fields = {
    requestId: event.context.requestId,
    method: event.method,
    path: event.path.split('?', 1)[0],
    status,
    durationMs: Math.round((performance.now() - (event.context.startedAt ?? performance.now())) * 10) / 10,
    userId: event.context.user?.id,
    ...extra,
  }
  if (status >= 500) log.error('request', fields)
  else log.info('request', fields)
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) }
  const cause = (error as { cause?: unknown }).cause
  return {
    error: error.message,
    name: error.name,
    stack: error.stack,
    ...(cause instanceof Error ? { cause: cause.message } : {}),
  }
}
