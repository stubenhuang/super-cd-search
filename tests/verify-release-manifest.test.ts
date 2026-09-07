import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const script = join(__dirname, '../scripts/verify-release-manifest.mjs')

let dir: string

function releasePath(): string {
  return join(dir, 'release')
}

function writeRelease(files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(releasePath(), name), content)
  }
}

function run(manifest: string, version: string, releaseDir: string = releasePath()) {
  return spawnSync(process.execPath, [script, manifest, version, releaseDir], { encoding: 'utf8' })
}

const validManifest = [
  'version: 1.0.2',
  'files:',
  '  - url: super-cd-search-setup-1.0.2.exe',
  '    sha512: abc',
  '    size: 123',
  'path: super-cd-search-setup-1.0.2.exe',
  'sha512: abc'
].join('\n')

describe('verify-release-manifest', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scd-manifest-'))
    mkdirSync(join(dir, 'release'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a manifest whose version and files match the release dir', () => {
    writeRelease({
      'latest.yml': validManifest,
      'super-cd-search-setup-1.0.2.exe': 'binary'
    })
    const result = run('latest.yml', '1.0.2')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('super-cd-search-setup-1.0.2.exe')
  })

  it('rejects a version that does not match the git tag', () => {
    writeRelease({
      'latest.yml': validManifest,
      'super-cd-search-setup-1.0.2.exe': 'binary'
    })
    const result = run('latest.yml', '1.0.3')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('does not match the expected "1.0.3"')
  })

  it('rejects a manifest declaring a file missing from the release dir', () => {
    writeRelease({ 'latest.yml': validManifest })
    const result = run('latest.yml', '1.0.2')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('does not contain it')
  })

  it('rejects file names containing whitespace (GitHub rewrites them)', () => {
    writeRelease({
      'latest.yml': [
        'version: 1.0.2',
        'files:',
        '  - url: Super CD Search-Setup-1.0.2.exe',
        'path: Super CD Search-Setup-1.0.2.exe'
      ].join('\n'),
      'Super CD Search-Setup-1.0.2.exe': 'binary'
    })
    const result = run('latest.yml', '1.0.2')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('contains whitespace')
  })

  it('rejects a manifest without a version field', () => {
    writeRelease({ 'latest.yml': 'files:\n  - url: a.exe\n' })
    const result = run('latest.yml', '1.0.2')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no "version" field')
  })

  it('rejects a missing manifest', () => {
    const result = run('latest.yml', '1.0.2')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('manifest not found')
  })

  it('fails with usage output when arguments are missing', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })
})
