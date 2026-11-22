import type { ApifySettings } from './types'

/**
 * Defaults for the Apify reverse-image-search sources. Actor ids use the `~`
 * form accepted by the Apify REST API; slash-form ids entered in settings are
 * normalized before use. The sources stay disabled by default (they are not in
 * DEFAULT_STANDARD_PLATFORMS / DEFAULT_DEEP_PLATFORMS) and require a token.
 */
export const DEFAULT_APIFY_SETTINGS: ApifySettings = {
  token: '',
  taobaoActor: 'dev00~taobao-reverse-image-search',
  xianyuActor: 'zen-studio~goofish-xianyu-visual-search-scraper',
  num: 20,
  maxItems: 100,
  timeoutMs: 180_000
}
