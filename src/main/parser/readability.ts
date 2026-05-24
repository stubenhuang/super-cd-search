import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

const MAX_CONTENT_LENGTH = 50000

export function compressHtml(html: string): string {
  let doc: Document

  try {
    const dom = new JSDOM(html, { url: 'about:blank' })
    doc = dom.window.document
  } catch {
    return stripHtmlTags(html)
  }

  try {
    const reader = new Readability(doc)
    const article = reader.parse()

    if (!article || !article.textContent) {
      return stripHtmlTags(html)
    }

    const parts: string[] = []
    if (article.title) parts.push(`TITLE: ${article.title}`)
    parts.push(article.textContent)

    let result = parts.join('\n\n')

    if (result.length > MAX_CONTENT_LENGTH) {
      result = result.slice(0, MAX_CONTENT_LENGTH) + '\n...[truncated]'
    }

    return result
  } catch {
    return stripHtmlTags(html)
  }
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