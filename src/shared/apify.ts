import type { ApifySettings } from './types'

/**
 * Defaults for the Apify reverse-image-search sources. Actor ids use the `~`
 * form accepted by the Apify REST API; slash-form ids entered in settings are
 * normalized before use. The sources stay disabled by default (they are not in
 * DEFAULT_STANDARD_PLATFORMS / DEFAULT_DEEP_PLATFORMS) and require a token.
 *
 * The Taobao actor also covers 1688; `marketplace: 'taobao'` is set explicitly
 * in the request. Taobao coverage is best-effort, the actor needs Apify Full
 * permissions and is pay-per-search.
 */
export const DEFAULT_APIFY_SETTINGS: ApifySettings = {
  token: '',
  taobaoActor: 'apivault_labs~1688-image-search',
  xianyuActor: 'zen-studio~goofish-xianyu-visual-search-scraper',
  num: 3,
  maxItems: 3,
  timeoutMs: 180_000
}

/** The old Taobao actor never returned dataset rows; retire only that exact id. */
const LEGACY_TAOBAO_ACTOR = 'dev00~taobao-reverse-image-search'

/**
 * Merge saved config over defaults. Saved settings win, except for the known
 * broken Taobao actor id, which is migrated so existing installs pick up the
 * working actor without overwriting a deliberately custom id.
 */
export function resolveApifySettings(raw?: Partial<ApifySettings>): ApifySettings {
  const settings = { ...DEFAULT_APIFY_SETTINGS, ...raw }
  if (settings.taobaoActor.trim().replace(/\//g, '~') === LEGACY_TAOBAO_ACTOR) {
    settings.taobaoActor = DEFAULT_APIFY_SETTINGS.taobaoActor
  }
  return settings
}
