#!/usr/bin/env node
/**
 * Validate an electron-builder update manifest before it is uploaded.
 *
 * The update manifest (`latest.yml` / `latest-mac.yml`) is what
 * electron-updater downloads and then follows to fetch the installer. Two
 * failure modes are easy to miss until users report broken updates:
 *
 *  1. The version does not match the git tag (packaging used a stale
 *     package.json).
 *  2. The file name in the manifest does not match the asset name on GitHub.
 *     Names containing spaces are the worst offender: electron-builder writes
 *     them with `-` while GitHub rewrites spaces to `.`, so the download 404s.
 *
 * Usage:
 *   node scripts/verify-release-manifest.mjs <manifest-file> <expected-version> [release-dir]
 *
 * Exits non-zero (with a description of every problem) when anything is off.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const [manifestName, expectedVersion, releaseDirArg] = process.argv.slice(2)
const releaseDir = releaseDirArg || 'release'

function fail(problems) {
  for (const problem of problems) {
    console.error(`[verify-manifest] ${problem}`)
  }
  process.exit(1)
}

if (!manifestName || !expectedVersion) {
  console.error('usage: node scripts/verify-release-manifest.mjs <manifest-file> <expected-version> [release-dir]')
  process.exit(2)
}

const manifestPath = join(releaseDir, manifestName)
if (!existsSync(manifestPath)) {
  fail([`manifest not found: ${manifestPath}`])
}
if (!existsSync(releaseDir)) {
  fail([`release directory not found: ${releaseDir}`])
}

const manifest = readFileSync(manifestPath, 'utf8')

const problems = []

const versionMatch = /^version:\s*(\S+)\s*$/m.exec(manifest)
if (!versionMatch) {
  problems.push(`${manifestName}: no "version" field`)
} else if (versionMatch[1] !== expectedVersion) {
  problems.push(`${manifestName}: version "${versionMatch[1]}" does not match the expected "${expectedVersion}"`)
}

// Every file the updater may download: `files[].url` (electron-updater 4+)
// and the legacy top-level `path`. The value is taken as the rest of the line
// so names containing spaces are detected instead of being truncated.
const clean = (value) => value.trim().replace(/^["']|["']$/g, '')
const declared = new Set()
for (const match of manifest.matchAll(/^\s*-\s*url:\s*(.+?)\s*$/gm)) declared.add(clean(match[1]))
for (const match of manifest.matchAll(/^\s*url:\s*(.+?)\s*$/gm)) declared.add(clean(match[1]))
for (const match of manifest.matchAll(/^\s*path:\s*(.+?)\s*$/gm)) declared.add(clean(match[1]))
if (declared.size === 0) {
  problems.push(`${manifestName}: declares no files to download`)
}

const packaged = new Set(readdirSync(releaseDir))
for (const name of declared) {
  if (/\s/.test(name)) {
    problems.push(`${manifestName}: "${name}" contains whitespace — GitHub rewrites it (spaces become dots) and the updater download 404s`)
  }
  if (!packaged.has(name)) {
    problems.push(`${manifestName}: declares "${name}" but ${releaseDir}/ does not contain it`)
  }
}

if (problems.length > 0) fail(problems)

console.log(`[verify-manifest] ${manifestName}: version ${expectedVersion}, ${declared.size} file(s) verified against ${releaseDir}/`)
for (const name of declared) {
  console.log(`[verify-manifest]   ok ${releaseDir}/${name}`)
}
