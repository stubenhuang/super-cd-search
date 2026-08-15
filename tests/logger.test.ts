import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  initLogger,
  logger,
  logFromRenderer,
  parseLogLevel,
  getLogLevel,
  getCurrentLogFile
} from '../src/main/logger'

let dir: string

function logFile(): string {
  const file = getCurrentLogFile()
  if (!file) throw new Error('logger has no current file')
  return file
}

function readLog(): string {
  return readFileSync(logFile(), 'utf8')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scd-log-'))
  process.env.SUPER_CD_LOG_LEVEL = ''
  initLogger({ dir, level: 'debug' })
})

afterEach(() => {
  initLogger({ level: 'warn' })
  rmSync(dir, { recursive: true, force: true })
})

describe('parseLogLevel', () => {
  it('normalizes supported level names and falls back for unknown values', () => {
    expect(parseLogLevel('debug')).toBe('debug')
    expect(parseLogLevel('TRACE', 'info')).toBe('debug')
    expect(parseLogLevel('warning')).toBe('warn')
    expect(parseLogLevel('error')).toBe('error')
    expect(parseLogLevel('verbose', 'info')).toBe('info')
    expect(parseLogLevel(undefined, 'info')).toBe('info')
  })
})

describe('logger', () => {
  it('initializes at the requested level and writes daily files', () => {
    expect(getLogLevel()).toBe('debug')
    expect(getCurrentLogFile()).toContain('super-cd-')
    expect(existsSync(logFile())).toBe(true)
  })

  it('writes debug/info/warn/error messages with tags and timestamps', () => {
    logger.debug('queries.cdjapan', 'debug message', { amount: 3000 })
    logger.info('orchestrator', 'info message', { status: 'found' })
    logger.warn('llm.client', 'warn message', { status: 429 })
    logger.error('browser.pool', 'error message', { error: 'boom' })

    const text = readLog()
    expect(text).toContain('[DEBUG] [queries.cdjapan] debug message')
    expect(text).toContain('"amount":3000')
    expect(text).toContain('[INFO] [orchestrator] info message')
    expect(text).toContain('[WARN] [llm.client] warn message')
    expect(text).toContain('[ERROR] [browser.pool] error message')
  })

  it('filters messages below the configured level', () => {
    initLogger({ dir, level: 'warn' })
    logger.info('test', 'hidden info')
    logger.debug('test', 'hidden debug')
    logger.warn('test', 'visible warn')

    const text = readLog()
    expect(text).not.toContain('hidden info')
    expect(text).not.toContain('hidden debug')
    expect(text).toContain('visible warn')
  })

  it('redacts secrets in messages and metadata', () => {
    logger.info('test', 'configured with apiKey=supersecret and token=abc123 and sk-abcdef123456', {
      apiKey: 'meta-secret',
      token: 'meta-token',
      cookie: 'cookie-secret',
      plain: 'sk-abcdef123456'
    })

    const text = readLog()
    expect(text).not.toContain('supersecret')
    expect(text).not.toContain('abc123')
    expect(text).not.toContain('sk-abcdef123456')
    expect(text).not.toContain('meta-secret')
    expect(text).not.toContain('meta-token')
    expect(text).not.toContain('cookie-secret')
    expect(text).toContain('sk-***')
  })

  it('truncates very long messages', () => {
    const long = 'x'.repeat(2000)
    logger.info('test', long)
    const text = readLog()
    expect(text).toContain('...[truncated]')
    expect(text.length).toBeLessThan(2000)
  })

  it('serializes Error, nested and bigint metadata safely', () => {
    logger.info('test', 'complex metadata', {
      error: new Error('sk-abcdef123456'),
      nested: { value: 1 },
      big: 10n
    })

    const text = readLog()
    expect(text).toContain('Error: sk-***')
    expect(text).toContain('"nested":')
    expect(text).toContain('"big":"10"')
  })

  it('survives circular metadata', () => {
    const circular: Record<string, unknown> = { name: 'cycle' }
    circular.self = circular
    expect(() => logger.info('test', 'circular metadata', { circular })).not.toThrow()
  })

  it('supports file-disabled initialization at info level', () => {
    initLogger({ level: 'info' })
    expect(getCurrentLogFile()).toBeNull()
    expect(getLogLevel()).toBe('info')
  })

  it('cleans up old log files beyond the retention limit', () => {
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(dir, `super-cd-202001${String(i + 1).padStart(2, '0')}.log`), 'old')
    }
    initLogger({ dir, level: 'debug' })

    const files = readdirSync(dir).filter(name => name.startsWith('super-cd-') && name.endsWith('.log'))
    expect(files.length).toBeLessThanOrEqual(11) // today's file + 10 retained
  })

  it('uses SUPER_CD_LOG_LEVEL when no explicit level is provided', () => {
    process.env.SUPER_CD_LOG_LEVEL = 'debug'
    initLogger({ dir, defaultLevel: 'info' })
    expect(getLogLevel()).toBe('debug')

    process.env.SUPER_CD_LOG_LEVEL = 'warn'
    initLogger({ dir, defaultLevel: 'info' })
    expect(getLogLevel()).toBe('warn')
  })

  it('supports renderer logs and normalizes invalid levels', () => {
    logFromRenderer('debug', 'app', 'renderer debug', { catalogNumber: 'X-1' })
    logFromRenderer('bogus', 'app', 'renderer fallback')

    const text = readLog()
    expect(text).toContain('[DEBUG] [renderer.app] renderer debug')
    expect(text).toContain('[INFO] [renderer.app] renderer fallback')
  })
})
