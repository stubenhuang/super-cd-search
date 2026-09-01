import { describe, it, expect } from 'vitest'
import {
  encryptSettings,
  decryptSettings,
  validateBackupPassword,
  SettingsBackupError,
  BACKUP_FORMAT_VERSION
} from '../src/main/settings/transfer'
import type { Settings, SettingsBackupEnvelope } from '../src/shared/types'

const settings: Settings = {
  discogsToken: 'discogs-secret-token',
  ebayClientId: 'client-id',
  ebayClientSecret: 'client-secret',
  proxyEnabled: true,
  proxyHost: '127.0.0.1',
  proxyPort: 8080,
  llm: {
    enabled: true,
    apiBaseUrl: 'https://api.example.com/v1',
    apiKey: 'llm-secret-key',
    model: 'model',
    platformEnabled: {
      discogs: true,
      ebay: false,
      kojima: true,
      hmv: true,
      yahoo: true,
      cdjapan: true,
      tower: true,
      surugaya: false,
      zenmarket: true
    }
  },
  standardPlatforms: ['discogs', 'tower'],
  deepPlatforms: ['discogs', 'ebay', 'hmv'],
  fastMode: true,
  displayCurrency: 'CNY',
  theme: 'dark',
  language: 'en',
  lanEnabled: true,
  lanHost: '192.168.1.5',
  lanPort: 9000,
  barcodeProviders: ['tower', 'discogs'],
  lastExportDirectory: '/tmp/exports'
}

const password = 'correct-horse-battery-staple'

describe('settings backup transfer', () => {
  it('round-trips settings through encryption and decryption', () => {
    const envelope = encryptSettings(settings, password)
    expect(envelope.app).toBe('super-cd-search')
    expect(envelope.formatVersion).toBe(BACKUP_FORMAT_VERSION)

    expect(decryptSettings(envelope, password)).toEqual(settings)
  })

  it('rejects a password shorter than the minimum length', () => {
    expect(validateBackupPassword('short')).toBe('weak_password')
    expect(validateBackupPassword('12345678')).toBeNull()
    expect(() => encryptSettings(settings, 'short')).toThrow(SettingsBackupError)
  })

  it('rejects decryption with the wrong password', () => {
    const envelope = encryptSettings(settings, password)
    expect(() => decryptSettings(envelope, 'totally-wrong-password')).toThrow('bad_password')
  })

  it('treats a tampered ciphertext as a bad password', () => {
    const envelope = encryptSettings(settings, password)
    const corrupted = Buffer.from(envelope.ciphertext, 'base64')
    corrupted[0] = corrupted[0] ^ 0xff
    const tampered: SettingsBackupEnvelope = {
      ...envelope,
      ciphertext: corrupted.toString('base64')
    }

    expect(() => decryptSettings(tampered, password)).toThrow('bad_password')
  })

  it('rejects a structurally invalid envelope as corrupt', () => {
    expect(() => decryptSettings({} as SettingsBackupEnvelope, password)).toThrow('corrupt_file')
    expect(() => decryptSettings(null as unknown as SettingsBackupEnvelope, password)).toThrow('corrupt_file')

    const envelope = encryptSettings(settings, password)
    expect(() => decryptSettings({ ...envelope, app: 'other-app' } as SettingsBackupEnvelope, password)).toThrow('corrupt_file')
  })

  it('rejects a newer format version as unsupported', () => {
    const envelope = encryptSettings(settings, password)
    const newer = { ...envelope, formatVersion: BACKUP_FORMAT_VERSION + 1 } as SettingsBackupEnvelope

    expect(() => decryptSettings(newer, password)).toThrow('unsupported_version')
  })

  it('never writes the password or any plaintext secret into the envelope', () => {
    const serialized = JSON.stringify(encryptSettings(settings, password))

    expect(serialized).not.toContain(password)
    expect(serialized).not.toContain('discogs-secret-token')
    expect(serialized).not.toContain('llm-secret-key')
    expect(serialized).not.toContain('client-secret')
  })
})
