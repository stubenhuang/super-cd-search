import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

// Register stealth once for the whole process. The headless scraping pool
// imports this module so the plugin is applied exactly once and never duplicated.
puppeteer.use(StealthPlugin())

export { puppeteer }
