import type { ApifySettings } from './types'

/**
 * Defaults for the Apify reverse-image-search sources. Actor ids use the `~`
 * form accepted by the Apify REST API; slash-form ids entered in settings are
 * normalized before use. The sources stay disabled by default (they are not in
 * DEFAULT_STANDARD_PLATFORMS / DEFAULT_DEEP_PLATFORMS) and require a token.
 *
 * The Taobao actor is dedicated to Taobao/Tmall photo search and needs only
 * Limited permissions (no one-time Console approval). Both sources are paid.
 */
export const DEFAULT_APIFY_SETTINGS: ApifySettings = {
  token: '',
  taobaoActor: 'dev00~taobao-reverse-image-search',
  xianyuActor: 'zen-studio~goofish-xianyu-visual-search-scraper',
  num: 3,
  maxItems: 3,
  timeoutMs: 180_000
}

/** The 1688 actor cannot verify Taobao cards; retire only that exact id. */
const BROKEN_TAOBAO_ACTOR = 'apivault_labs~1688-image-search'

/**
 * Merge saved config over defaults. Saved settings win, except for the known
 * broken 1688 actor id, which is migrated back to the dedicated Taobao actor
 * without overwriting a deliberately custom id.
 */
export function resolveApifySettings(raw?: Partial<ApifySettings>): ApifySettings {
  const settings = { ...DEFAULT_APIFY_SETTINGS, ...raw }
  if (settings.taobaoActor.trim().replace(/\//g, '~') === BROKEN_TAOBAO_ACTOR) {
    settings.taobaoActor = DEFAULT_APIFY_SETTINGS.taobaoActor
  }
  return settings
}
