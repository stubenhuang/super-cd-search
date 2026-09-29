import type { PublishTarget } from '../../src/shared/publish'

/**
 * Fixtures for the publish suites, which all need the target list to come out
 * of `getSetting('publishTargets')`.
 */

/**
 * A `getSetting` implementation that answers `publishTargets` (plus any extra
 * keys the suite needs, e.g. `discogsToken`), and returns undefined otherwise.
 */
export function settingReaderWithTargets(
  targets: PublishTarget[],
  extras: Record<string, unknown> = {}
) {
  return (key: string): unknown => {
    if (key === 'publishTargets') return targets
    return extras[key]
  }
}
