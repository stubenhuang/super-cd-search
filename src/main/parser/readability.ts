import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

const MAX_CONTENT_LENGTH = 50000

export interface CompressedContent {
  text: string
  pageUrl: string
  imageUrls: string[]
  linkUrls: string[]
}

export function compressHtml(html: string, pageUrl: string = 'about:blank'): CompressedContent {
  let doc: Document

  try {
    const dom = new JSDOM(html, { url: pageUrl })
    doc = dom.window.document
  } catch {
    return {
      text: withStructuredData(stripHtmlTags(html), html),
      pageUrl,
      imageUrls: extractUrls(html, 'img', 'src'),
      linkUrls: extractUrls(html, 'a', 'href')
    }
  }

  // Extract URLs before Readability strips them
  const imageUrls = extractUrlsFromDoc(doc, 'img', 'src')
  const linkUrls = extractUrlsFromDoc(doc, 'a', 'href')

  try {
    const reader = new Readability(doc)
    const article = reader.parse()

    if (!article || !article.textContent) {
      return {
        text: withStructuredData(stripHtmlTags(html), html),
        pageUrl,
        imageUrls,
        linkUrls
      }
    }

    const parts: string[] = []
    if (article.title) parts.push(`TITLE: ${article.title}`)
    parts.push(article.textContent)

    // Append extracted URLs section
    if (imageUrls.length > 0) {
      parts.push('\n[IMAGE URLs]')
      imageUrls.forEach(url => parts.push(url))
    }
    if (linkUrls.length > 0) {
      parts.push('\n[LINK URLs]')
      linkUrls.slice(0, 20).forEach(url => parts.push(url)) // Limit links to avoid token bloat
    }

    let result = parts.join('\n')
    result = withStructuredData(result, html)

    if (result.length > MAX_CONTENT_LENGTH) {
      result = result.slice(0, MAX_CONTENT_LENGTH) + '\n...[truncated]'
    }

    return {
      text: result,
      pageUrl,
      imageUrls,
      linkUrls
    }
  } catch {
    return {
      text: withStructuredData(stripHtmlTags(html), html),
      pageUrl,
      imageUrls,
      linkUrls
    }
  }
}

/**
 * Append a machine-readable [STRUCTURED DATA] section extracted from the
 * page's JSON-LD (schema.org Product) blocks.
 *
 * Japanese retailers (Tower, HMV, CDJapan, ...) embed the authoritative item
 * metadata — genre, release date, label/brand, format, artist — as JSON-LD.
 * Readability strips <script> tags, so without this the LLM only sees a
 * flattened spec table where labels and values run together. Surfacing the
 * structured fields makes extraction accurate and consistent.
 */
export function extractStructuredData(html: string): string[] {
  const lines: string[] = []
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null

  while ((match = scriptRegex.exec(html)) !== null) {
    let data: unknown
    try {
      data = JSON.parse(match[1].trim())
    } catch {
      continue // Malformed JSON-LD block — ignore.
    }

    const product = findProduct(data)
    if (!product) continue

    const name = stringValue(product.name)
    if (name) lines.push(`name: ${name}`)

    const artist = nestedName(product.byArtist)
    if (artist) lines.push(`artist: ${artist}`)

    const label = nestedName(product.brand)
    if (label) lines.push(`label: ${label}`)

    const format = stringValue(product.itemVariant)
    if (format) lines.push(`format: ${format}`)

    const released = stringValue(product.releaseDate)
    if (released) lines.push(`released: ${released}`)

    const genre = listValue(product.genre)
    if (genre) lines.push(`genre: ${genre}`)
  }

  return lines
}

function withStructuredData(text: string, html: string): string {
  const structured = extractStructuredData(html)
  if (structured.length === 0) return text
  return `${text}\n\n[STRUCTURED DATA]\n${structured.join('\n')}`
}

/** Recursively locate the first schema.org Product object (incl. @graph). */
function findProduct(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProduct(item)
      if (found) return found
    }
    return null
  }
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  const type = record['@type']
  const types = Array.isArray(type) ? type : [type]
  if (types.some(t => t === 'Product')) return record

  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'hasPart']) {
    if (key in record) {
      const found = findProduct(record[key])
      if (found) return found
    }
  }
  return null
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && !Number.isNaN(value)) return String(value)
  return null
}

/** Read a string-or-{name}-or-array field (e.g. byArtist, brand). */
function nestedName(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    const names = value.map(nestedName).filter((n): n is string => n !== null)
    return names.length > 0 ? names.join(', ') : null
  }
  if (typeof value === 'object' && value !== null) {
    return stringValue((value as Record<string, unknown>).name)
  }
  return null
}

/** Read a string-or-string[] field (e.g. genre) and join it. */
function listValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    const items = value.map(stringValue).filter((v): v is string => v !== null)
    return items.length > 0 ? items.join(', ') : null
  }
  return null
}

function extractUrlsFromDoc(doc: Document, selector: string, attr: string): string[] {
  const urls: string[] = []
  const elements = doc.querySelectorAll(selector)
  elements.forEach(el => {
    const url = el.getAttribute(attr)
    if (url && url.length > 0 && !url.startsWith('javascript:') && !url.startsWith('data:')) {
      urls.push(url)
    }
  })
  return urls.slice(0, 50) // Limit to prevent token bloat
}

function extractUrls(html: string, tag: string, attr: string): string[] {
  const urls: string[] = []
  const regex = new RegExp(`<${tag}[^>]+${attr}="([^"]+)"`, 'gi')
  let match
  while ((match = regex.exec(html)) !== null) {
    const url = match[1]
    if (url && !url.startsWith('javascript:') && !url.startsWith('data:')) {
      urls.push(url)
    }
  }
  return urls.slice(0, 50)
}

function stripHtmlTags(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length > MAX_CONTENT_LENGTH) {
    text = text.slice(0, MAX_CONTENT_LENGTH) + ' ...[truncated]'
  }

  return text
}