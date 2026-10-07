// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Security Middleware
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per window
});
app.use('/api/', limiter);

// SSRF Protection & URL Validation Utility
const isValidUrl = (url) => {
  try {
    const parsed = new URL(url);
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
    return parsed.protocol === 'https:' && !blockedHosts.includes(parsed.hostname);
  } catch (e) {
    return false;
  }
};

// Phase 1 Route Placeholder
app.post('/api/resolve', async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ 
      success: false, 
      code: 'INVALID_URL', 
      message: 'Please paste a valid HTTPS link.' 
    });
  }

  // Resolver logic will be implemented in Phase 4
  res.json({ 
    success: true, 
    message: 'Backend is connected and validating URLs.',
    platform: 'detected_soon'
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Pro Downloader Backend running on port ${PORT}`));
