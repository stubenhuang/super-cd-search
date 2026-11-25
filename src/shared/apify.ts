import type { ApifySettings } from './types'

/**
 * Defaults for the Apify search sources. Actor ids use the `~` form accepted by
 * the Apify REST API; slash-form ids entered in settings are normalized before
 * use. The sources stay disabled by default (they are not in
 * DEFAULT_STANDARD_PLATFORMS / DEFAULT_DEEP_PLATFORMS) and require a token.
 *
 * Taobao is a keyword/catalog-number source (zen-studio~taobao-search-scraper,
 * Limited permissions); Xianyu is a reverse-image source. Both are paid.
 */
export const DEFAULT_APIFY_SETTINGS: ApifySettings = {
  token: '',
  taobaoActor: 'zen-studio~taobao-search-scraper',
  xianyuActor: 'zen-studio~goofish-xianyu-visual-search-scraper',
  num: 10,
  maxItems: 3,
  timeoutMs: 180_000
}

/** Both reverse-image actors proved unusable for Taobao; retire those ids. */
const BROKEN_TAOBAO_ACTORS = [
  'apivault_labs~1688-image-search',
  'dev00~taobao-reverse-image-search'
]

/**
 * Merge saved config over defaults. Saved settings win, except for the known
 * broken reverse-image actor ids, which are migrated to the keyword-search
 * actor without overwriting a deliberately custom id. `num` is normalized to
 * the Taobao actor's 10..1000 range, so the configured value is exactly the
 * maxItems sent to the actor (old configs below 10 are raised here rather
 * than being silently overridden at request time).
 */
export function resolveApifySettings(raw?: Partial<ApifySettings>): ApifySettings {
  const settings = { ...DEFAULT_APIFY_SETTINGS, ...raw }
  if (BROKEN_TAOBAO_ACTORS.includes(settings.taobaoActor.trim().replace(/\//g, '~'))) {
    settings.taobaoActor = DEFAULT_APIFY_SETTINGS.taobaoActor
  }
  const num = Number(settings.num)
  settings.num = Number.isFinite(num)
    ? Math.min(1000, Math.max(10, Math.round(num)))
    : DEFAULT_APIFY_SETTINGS.num
  return settings
}
