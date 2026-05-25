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
      text: stripHtmlTags(html),
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
        text: stripHtmlTags(html),
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
      text: stripHtmlTags(html),
      pageUrl,
      imageUrls,
      linkUrls
    }
  }
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