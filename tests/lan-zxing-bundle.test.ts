import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { writeBarcode, prepareZXingModule } from 'zxing-wasm/writer'

const generatedBundlePath = join(process.cwd(), 'src/main/lan/zxing-wasm.browser.js')
const writerWasmPath = join(process.cwd(), 'node_modules/zxing-wasm/dist/writer/zxing_writer.wasm')

prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(writerWasmPath)
  }
})

function loadBrowserBundle() {
  const code = readFileSync(generatedBundlePath, 'utf8')
  const factory = new Function(`${code}\nreturn ZXingWasmReader;`)
  return factory() as { decodeBarcodeFile: (file: Blob) => Promise<string | null> }
}

describe('mobile zxing bundle', () => {
  it('decodes a small EAN-13 barcode embedded in a large photo-like image', async () => {
    const reader = loadBrowserBundle()

    const barcode = await writeBarcode('4943674029365', {
      format: 'EAN13',
      scale: 2,
      addQuietZones: true
    })
    const small = PNG.sync.read(Buffer.from(await barcode.image.arrayBuffer()))

    // Reproduce the reported bug shape: a phone photo where the barcode is a
    // small region of a much larger image.
    const large = new PNG({ width: 1200, height: 1600 })
    large.data.fill(255)
    const offsetX = 880
    const offsetY = 900
    for (let y = 0; y < small.height; y++) {
      for (let x = 0; x < small.width; x++) {
        const src = (y * small.width + x) * 4
        const dst = ((offsetY + y) * large.width + (offsetX + x)) * 4
        large.data[dst] = small.data[src]
        large.data[dst + 1] = small.data[src + 1]
        large.data[dst + 2] = small.data[src + 2]
        large.data[dst + 3] = small.data[src + 3]
      }
    }

    const photoBlob = new Blob([PNG.sync.write(large)], { type: 'image/png' })
    await expect(reader.decodeBarcodeFile(photoBlob)).resolves.toBe('4943674029365')
  })
})
