import { existsSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync, appendFileSync } from 'fs'
import { join } from 'path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerMeta {
  [key: string]: unknown
}

export interface LoggerOptions {
  /** Directory used for rotating daily log files. File output is disabled when omitted. */
  dir?: string
  /** Explicit level, e.g. from `--log-level=debug`. Overrides env/default. */
  level?: string
  /** Used when neither the explicit level nor SUPER_CD_LOG_LEVEL is set. */
  defaultLevel?: LogLevel
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
}

const MAX_VALUE_LENGTH = 1000
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_LOG_FILES = 10
const LOG_FILE_PREFIX = 'super-cd-'

let currentLevel: LogLevel = 'warn'
let initialized = false
let logDir: string | null = null
let currentFile: string | null = null
let currentFileDate = ''
let currentFileSize = 0
let fileWriteFailed = false

/** Keys whose metadata values are always redacted. */
const SECRET_KEY_PATTERN = /(key|token|secret|password|cookie|authorization)/i

const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /(sk-[A-Za-z0-9_-]{4,})/gi, replacement: 'sk-***' },
  { pattern: /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, replacement: '$1***' },
  { pattern: /(\btoken\s*=\s*)[^&\s]+/gi, replacement: '$1***' },
  { pattern: /(api[_-]?key["']?\s*[:=]\s*["']?)[^"',&\s]+/gi, replacement: '$1***' },
  { pattern: /(client[_-]?secret["']?\s*[:=]\s*["']?)[^"',&\s]+/gi, replacement: '$1***' },
  { pattern: /(password["']?\s*[:=]\s*["']?)[^"',&\s]+/gi, replacement: '$1***' }
]

export function parseLogLevel(value: string | null | undefined, fallback: LogLevel = 'info'): LogLevel {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'debug' || normalized === 'trace') return 'debug'
  if (normalized === 'info') return 'info'
  if (normalized === 'warn' || normalized === 'warning') return 'warn'
  if (normalized === 'error') return 'error'
  return fallback
}

function redactString(value: string): string {
  let result = value
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return '***'
  if (typeof value === 'string') {
    const redacted = redactString(value)
    return redacted.length > MAX_VALUE_LENGTH ? `${redacted.slice(0, MAX_VALUE_LENGTH)}...[truncated]` : redacted
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (value instanceof Error) {
    return `${value.name}: ${redactString(value.message).slice(0, MAX_VALUE_LENGTH)}`
  }
  return value
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(value, (key, inner) => {
      if (typeof inner === 'bigint') return String(inner)
      if (SECRET_KEY_PATTERN.test(key) && typeof inner === 'string') return '***'
      return inner
    })
  } catch {
    return String(value)
  }
}

function serializeMeta(meta?: LoggerMeta): string {
  if (!meta) return ''
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    safe[key] = redactValue(key, value)
  }
  const serialized = serialize(safe)
  return serialized.length > MAX_VALUE_LENGTH
    ? `${serialized.slice(0, MAX_VALUE_LENGTH)}...[truncated]`
    : serialized
}

function dateStamp(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function timestamp(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${dateStamp(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`
}

function filePathForDate(dir: string, date: string): string {
  return join(dir, `${LOG_FILE_PREFIX}${date}.log`)
}

function cleanupOldLogs(): void {
  if (!logDir) return
  try {
    const files = readdirSync(logDir)
      .filter(name => /^super-cd-\d{8}\.log(\.\d+)?$/.test(name))
      .map(name => ({ name, mtimeMs: statSync(join(logDir!, name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)

    for (const file of files.slice(MAX_LOG_FILES)) {
      unlinkSync(join(logDir, file.name))
    }
  } catch {
    // Best-effort cleanup; logging must never crash the app.
  }
}

function rotateCurrentFile(): void {
  if (!currentFile) return
  try {
    // Shift numbered backups: .1 -> .2 -> ... -> .MAX
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const previous = `${currentFile}.${i}`
      const next = `${currentFile}.${i + 1}`
      if (existsSync(previous)) {
        if (i === MAX_LOG_FILES - 1 && existsSync(next)) unlinkSync(next)
        renameSync(previous, next)
      }
    }
    renameSync(currentFile, `${currentFile}.1`)
    currentFileSize = 0
  } catch {
    // Rotation is best-effort.
  }
}

function ensureLogFile(date: string): void {
  if (!logDir || fileWriteFailed) return

  if (currentFileDate !== date || !currentFile) {
    currentFileDate = date
    currentFile = filePathForDate(logDir, date)
    try {
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
      currentFileSize = existsSync(currentFile) ? statSync(currentFile).size : 0
    } catch {
      currentFile = null
      fileWriteFailed = true
      return
    }
  }

  if (currentFileSize >= MAX_FILE_SIZE) {
    rotateCurrentFile()
  }
}

function writeToFile(level: LogLevel, line: string): void {
  if (!logDir) return
  const date = dateStamp()
  ensureLogFile(date)
  if (!currentFile || fileWriteFailed) return

  try {
    appendFileSync(currentFile, `${line}\n`)
    currentFileSize += Buffer.byteLength(line, 'utf8') + 1
  } catch (err) {
    fileWriteFailed = true
    console.error(`[logger] failed to write log file:`, err)
  }
}

function formatMessage(message: string): string {
  const redacted = redactString(message)
  return redacted.length > MAX_VALUE_LENGTH ? `${redacted.slice(0, MAX_VALUE_LENGTH)}...[truncated]` : redacted
}

function emit(level: LogLevel, tag: string, message: string, meta?: LoggerMeta): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return

  const metaText = serializeMeta(meta)
  const line = `${timestamp()} [${LEVEL_LABELS[level]}] [${tag}] ${formatMessage(message)}${metaText ? ` ${metaText}` : ''}`

  if (initialized && logDir) {
    writeToFile(level, line)
  }

  const consoleFn = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error
  consoleFn(line)
}

/**
 * Initialize the logger. Called once at app startup, after userData is known.
 * Until this is called, only WARN and ERROR messages go to the console and
 * nothing is written to disk.
 */
export function initLogger(options: LoggerOptions = {}): void {
  const envLevel = process.env.SUPER_CD_LOG_LEVEL
  const explicitLevel = options.level ?? envLevel
  currentLevel = parseLogLevel(explicitLevel, options.defaultLevel ?? 'info')
  logDir = options.dir ?? null
  fileWriteFailed = false
  currentFile = null
  currentFileDate = ''
  currentFileSize = 0
  initialized = true

  if (logDir) {
    try {
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
      cleanupOldLogs()
      emit('info', 'logger', `logger initialized (level=${currentLevel})`, { dir: logDir })
    } catch (err) {
      logDir = null
      console.error('[logger] failed to initialize log directory:', err)
    }
  } else {
    emit('info', 'logger', `logger initialized (level=${currentLevel}, file output disabled)`)
  }
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

/** Current log file path, exposed for diagnostics and tests. */
export function getCurrentLogFile(): string | null {
  return currentFile
}

function log(level: LogLevel, tag: string, message: string, meta?: LoggerMeta): void {
  emit(level, tag, message, meta)
}

export const logger = {
  debug: (tag: string, message: string, meta?: LoggerMeta): void => log('debug', tag, message, meta),
  info: (tag: string, message: string, meta?: LoggerMeta): void => log('info', tag, message, meta),
  warn: (tag: string, message: string, meta?: LoggerMeta): void => log('warn', tag, message, meta),
  error: (tag: string, message: string, meta?: LoggerMeta): void => log('error', tag, message, meta)
}

export function logFromRenderer(level: string, tag: string, message: string, meta?: LoggerMeta): void {
  const normalized = parseLogLevel(level, 'info')
  emit(normalized, `renderer.${tag}`, message, meta)
}
