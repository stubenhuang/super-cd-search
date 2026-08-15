import { describe, it, expect } from 'vitest'
import { compressHtml } from '../src/main/parser/readability'

describe('compressHtml', () => {
  it('extracts article text, title, image URLs and link URLs', () => {
    const html = `
      <html>
        <head><title>Great Album</title></head>
        <body>
          <article>
            <h1>Great Album</h1>
            <p>Some descriptive text about the album.</p>
            <img src="https://cdn.example.com/cover.jpg">
            <img src="javascript:void(0)">
            <img src="data:image/gif;base64,AAAA">
            <a href="https://www.example.com/release/1">release</a>
            <a href="/search">search</a>
            <a href="mailto:a@b.c">mail</a>
          </article>
        </body>
      </html>`

    const result = compressHtml(html, 'https://www.example.com/album/1')
    expect(result.text).toContain('TITLE: Great Album')
    expect(result.text).toContain('Some descriptive text about the album.')
    expect(result.text).toContain('[IMAGE URLs]')
    expect(result.text).toContain('https://cdn.example.com/cover.jpg')
    expect(result.text).toContain('[LINK URLs]')
    expect(result.text).toContain('https://www.example.com/release/1')
    expect(result.pageUrl).toBe('https://www.example.com/album/1')
    expect(result.imageUrls).toEqual(['https://cdn.example.com/cover.jpg'])
    expect(result.linkUrls).toEqual(['https://www.example.com/release/1', '/search', 'mailto:a@b.c'])
  })

  it('falls back to stripped text when Readability finds no article', () => {
    const html = '<html><body><div class="layout">Only navigation markup here</div></body></html>'
    const result = compressHtml(html)
    expect(result.text).toContain('Only navigation markup here')
    expect(result.text).not.toContain('<div')
    expect(result.imageUrls).toEqual([])
    expect(result.linkUrls).toEqual([])
  })

  it('limits extracted URLs to 50 entries', () => {
    const links = Array.from({ length: 80 }, (_, i) => `<a href="https://x.example.com/${i}">${i}</a>`).join('')
    const result = compressHtml(`<html><body>${links}</body></html>`)
    expect(result.linkUrls.length).toBe(50)
  })

  it('truncates very long content', () => {
    const longText = 'x'.repeat(60000)
    const result = compressHtml(`<html><body><article><p>${longText}</p></article></body></html>`)
    expect(result.text.length).toBeLessThanOrEqual(50000 + 15)
    expect(result.text.endsWith('...[truncated]')).toBe(true)
  })

  it('defaults pageUrl to about:blank', () => {
    const result = compressHtml('<html><body><p>hello</p></body></html>')
    expect(result.pageUrl).toBe('about:blank')
  })

  it('excludes image and link URLs that are empty', () => {
    const html = '<html><body><img src=""><a href="">x</a></body></html>'
    const result = compressHtml(html)
    expect(result.imageUrls).toEqual([])
    expect(result.linkUrls).toEqual([])
  })

  it('falls back to stripped text for empty documents', () => {
    const result = compressHtml('<html><body></body></html>')
    expect(result.text).toBe('')
    expect(result.pageUrl).toBe('about:blank')
  })

  it('strips scripts and styles in the fallback path', () => {
    const html = '<html><body><script>var x = 1;</script><style>.a { color: red }</style><div>visible text</div></body></html>'
    const result = compressHtml(html)
    expect(result.text).not.toContain('var x')
    expect(result.text).not.toContain('color: red')
    expect(result.text).toContain('visible text')
  })

  it('surfaces JSON-LD Product structured data next to the article text', () => {
    const html = `
      <html>
        <head><title>Great Album</title></head>
        <body>
          <article><p>Some descriptive text about the album.</p></article>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": "ベートーヴェン: チェロ・ソナタ全曲",
            "byArtist": { "@type": "Person", "name": "ピエール・フルニエ" },
            "genre": "クラシック",
            "itemVariant": "CD",
            "releaseDate": "2015-06-17",
            "brand": { "@type": "Organization", "name": "TOWER RECORDS UNIVERSAL VINTAGE COLLECTION +plus" }
          }
          </script>
        </body>
      </html>`

    const result = compressHtml(html, 'https://tower.jp/item/3895788')
    expect(result.text).toContain('[STRUCTURED DATA]')
    expect(result.text).toContain('genre: クラシック')
    expect(result.text).toContain('label: TOWER RECORDS UNIVERSAL VINTAGE COLLECTION +plus')
    expect(result.text).toContain('format: CD')
    expect(result.text).toContain('released: 2015-06-17')
    expect(result.text).toContain('artist: ピエール・フルニエ')
    expect(result.text).toContain('name: ベートーヴェン: チェロ・ソナタ全曲')
  })

  it('handles JSON-LD with @graph and array genres', () => {
    const html = `
      <html>
        <body>
          <p>body text</p>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "WebSite", "name": "Shop" },
              {
                "@type": "Product",
                "name": "Some Album",
                "genre": ["Rock", "Prog Rock"],
                "itemVariant": "CD",
                "brand": "Sony Music Labels"
              }
            ]
          }
          </script>
        </body>
      </html>`

    const result = compressHtml(html)
    expect(result.text).toContain('genre: Rock, Prog Rock')
    expect(result.text).toContain('label: Sony Music Labels')
  })

  it('skips structured data when the page has no JSON-LD', () => {
    const html = '<html><body><article><p>No schema here.</p></article></body></html>'
    const result = compressHtml(html)
    expect(result.text).not.toContain('[STRUCTURED DATA]')
  })

  it('ignores malformed JSON-LD blocks', () => {
    const html = `
      <html>
        <body>
          <p>valid text</p>
          <script type="application/ld+json">{ not valid json </script>
        </body>
      </html>`
    const result = compressHtml(html)
    expect(result.text).toContain('valid text')
    expect(result.text).not.toContain('[STRUCTURED DATA]')
  })
})
