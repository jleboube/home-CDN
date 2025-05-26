import express from 'express'
import compression from 'compression'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createClient } from 'redis'
import responseTime from 'response-time'
import { optimize } from './middleware/optimizer.js'

const app = express()
// Trust the first proxy hop (e.g., Load Balancer, Nginx) for IP detection
app.set('trust proxy', 1)

// ↳ Add response time header (X-Response-Time)
app.use(responseTime())

// ↳ Security headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Allow images from self, data URIs, and blobs
        imgSrc: ["'self'", 'data:', 'blob:'],
        // Adjust other directives as needed for your specific application
      },
    },
    crossOriginEmbedderPolicy: true, // Recommended for security
    crossOriginOpenerPolicy: true, // Recommended for security
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allows cross-origin image requests
  }),
)

// ↳ Generic rate limiting for the image endpoint
const imageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15  utes
  limit: 1000, // Limit each IP to 1000 requests per windowMs
  standardHeaders: 'draft-7', // Use RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  message: { error: 'Too many requests, please try again later.' },
})
app.use('/images', imageLimiter)

// ↳ Enable gzip/brotli compression
app.use(compression())

// ↳ Connect Redis v4 for caching
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
})

redisClient.on('error', (err) => console.error('Redis Client Error:', err))

// Use a top-level async function to connect Redis
async function connectRedis() {
  try {
    await redisClient.connect()
    console.log('Connected to Redis')
  } catch (err) {
    console.error('Failed to connect to Redis:', err)
    // Optionally exit or implement retry logic
    process.exit(1)
  }
}
connectRedis() // Connect on startup

// ↳ Caching middleware
async function cache(req, res, next) {
  const key = `img:${req.originalUrl}` // Use the full URL as the cache key
  const requestedFormat = req.accepts(['avif', 'webp', 'jpeg']) || 'jpeg'

  try {
    const cachedData = await redisClient.get(key)
    if (cachedData) {
      console.log(`Cache HIT for ${key}`)
      return res.type(`image/${requestedFormat}`).send(Buffer.from(cachedData, 'base64'))
    }
  } catch (err) {
    console.error('Redis GET error:', err)
    // Proceed without cache if Redis fails
  }

  console.log(`Cache MISS for ${key}`)
  // Monkey-patch res.send to cache the response before sending
  const originalSend = res.send.bind(res)
  res.send = async (body) => {
    // Only cache successful responses (2xx) and if body is a buffer
    if (res.statusCode >= 200 && res.statusCode < 300 && Buffer.isBuffer(body)) {
      try {
        // Cache for 1 day (86400 seconds)
        await redisClient.set(key, body.toString('base64'), { EX: 86400 })
      } catch (err) {
        console.error('Redis SET error:', err)
      }
    }
    return originalSend(body) // Call the original send method
  }
  next()
}

// ↳ Image optimization route
app.get('/images/:image', cache, optimize)

// ↳ Centralized error handler
app.use((err, req, res, _next) => {
  console.error('Error:', {
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined, // Show stack only in dev
    path: req.path,
    method: req.method,
  })

  // Avoid sending stack trace in production
  const statusCode = err.status || 500
  const errorMessage =
    process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'Internal Server Error'
      : err.message
  res.status(statusCode).json({ error: errorMessage })
})

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Image CDN listening on :${port}`))

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...')
  try {
    await redisClient.quit()
    console.log('Redis connection closed.')
  } catch (err) {
    console.error('Error closing Redis connection:', err)
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)