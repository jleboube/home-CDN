import sharp from 'sharp'
import path from 'node:path'
import fs from 'node:fs/promises' // Keep for potential local fallback/testing

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp'])

export async function optimize(req, res, next) {
  try {
    const { image } = req.params
    const ext = path.extname(image).toLowerCase()
    if (!ALLOWED.has(ext)) return res.status(400).json({ error: 'Unsupported format' })

    // In a real app, fetch the image from storage (e.g., S3 via pre-signed URL)
    // For this example, we'll stick to local files for simplicity, but see the storage section.
    const src = path.join(process.cwd(), 'images', image)
    let imageBuffer
    try {
      imageBuffer = await fs.readFile(src)
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Image not found' })
      }
      throw err // Re-throw other fs errors
    }

    const width = Number(req.query.width) || null
    const quality = Number(req.query.quality) || 85
    const format = req.accepts(['avif', 'webp', 'jpeg']) || 'jpeg'

    let pipeline = sharp(imageBuffer)
      .rotate() // Auto-rotate based on EXIF
      .withMetadata() // Preserve metadata (like copyright)

    if (width) {
      pipeline = pipeline.resize({ width, withoutEnlargement: true })
    }

    switch (format) {
      case 'avif':
        pipeline = pipeline.avif({ quality, effort: 4 }) // effort 4 is a good balance
        break
      case 'webp':
        pipeline = pipeline.webp({ quality })
        break
      default: // jpeg
        pipeline = pipeline.jpeg({ quality, mozjpeg: true }) // Use mozjpeg for better compression
    }

    const optimizedBuffer = await pipeline.toBuffer()
    res.type(`image/${format}`).send(optimizedBuffer)
  } catch (err) {
    // Pass errors to the central error handler
    next(err)
  }
}