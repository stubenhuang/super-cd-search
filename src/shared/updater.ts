/**
 * Auto-update state shared between the main process (electron-updater) and the
 * renderer (settings panel + update banner).
 *
 * Kept free of Electron imports so it can be unit-tested directly.
 */

export type UpdateStatus =
  /** Never checked yet. */
  | 'idle'
  /** Builds that cannot self-update (dev, or the Windows portable build). */
  | 'unsupported'
  | 'checking'
  /** Already on the latest published version. */
  | 'not-available'
  /** A newer version exists; not downloaded yet. */
  | 'available'
  | 'downloading'
  /** Download finished; the user can restart to install. */
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** Version currently running (`app.getVersion()`). */
  currentVersion: string
  latestVersion?: string
  releaseNotes?: string
  /** GitHub release page for the latest version. */
  releaseUrl?: string
  /** Download progress in percent (0-100) while `downloading`. */
  progress?: number
  error?: string
  /** True when the running check was triggered by the user. */
  manual?: boolean
}

/** Version of the GitHub repository surfaced in the UI. */
export const GITHUB_REPO_URL = 'https://github.com/stubenhuang/super-cd-search'

/** Strip a leading `v` and surrounding whitespace: `v1.2.3` -> `1.2.3`. */
export function normalizeVersion(raw?: string | null): string {
  return (raw ?? '').trim().replace(/^v/i, '')
}

interface ParsedVersion {
  numbers: [number, number, number]
  prerelease: string | null
}

const VERSION_PATTERN = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+](.*))?$/

/** Parse a semver-ish string; returns null for anything unrecognised. */
export function parseVersion(raw?: string | null): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(normalizeVersion(raw))
  if (!match) return null
  return {
    numbers: [
      Number.parseInt(match[1] ?? '0', 10) || 0,
      Number.parseInt(match[2] ?? '0', 10) || 0,
      Number.parseInt(match[3] ?? '0', 10) || 0
    ],
    prerelease: match[4] ? match[4] : null
  }
}

/**
 * Compare two versions: -1 when `a < b`, 0 when equal, 1 when `a > b`.
 * A version without a pre-release tag wins over the same numbers with one
 * (`1.0.0` > `1.0.0-beta.1`). Unparseable versions sort last.
 */
export function compareVersions(a?: string | null, b?: string | null): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1

  for (let index = 0; index < 3; index++) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] < right.numbers[index] ? -1 : 1
    }
  }

  if (left.prerelease === right.prerelease) return 0
  if (left.prerelease === null) return 1
  if (right.prerelease === null) return -1
  return left.prerelease < right.prerelease ? -1 : 1
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate?: string | null, current?: string | null): boolean {
  return compareVersions(candidate, current) > 0
}

/** Statuses worth surfacing outside the settings panel (banner / toast). */
export function isVisibleUpdateStatus(status: UpdateStatus): boolean {
  return status === 'available' || status === 'downloading' || status === 'downloaded'
}
