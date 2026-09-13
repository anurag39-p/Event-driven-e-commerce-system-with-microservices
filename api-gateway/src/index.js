require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.get('/health', (req, res) => {
  res.status(200).json({ service: 'api-gateway', status: 'ok', timestamp: new Date().toISOString() });
});

const PUBLIC_PATHS = ['/users/register', '/users/login'];

function isPublicPath(req) {
  if (req.path.endsWith('/health')) return true;
  if (PUBLIC_PATHS.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return true;
  if (req.path === '/products' || req.path.startsWith('/products/')) {
    return req.method === 'GET';
  }
  return false;
}

function verifyJWT(req, res, next) {
  if (isPublicPath(req)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.headers['x-user-id'] = String(decoded.sub);
    req.headers['x-user-email'] = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

app.use('/api', verifyJWT);

const targets = {
  '/api/users': process.env.USER_SERVICE_URL || 'http://user-service:4001',
  '/api/products': process.env.PRODUCT_SERVICE_URL || 'http://product-service:4002',
  '/api/orders': process.env.ORDER_SERVICE_URL || 'http://order-service:4003',
  '/api/payments': process.env.PAYMENT_SERVICE_URL || 'http://payment-service:4004',
  '/api/notifications': process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4005',
};

Object.entries(targets).forEach(([prefix, target]) => {
  app.use(
    prefix,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: { [`^${prefix}`]: '' },
      onError: (err, req, res) => {
        res.status(502).json({ error: 'Upstream service unavailable', service: prefix });
      },
    })
  );
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[api-gateway] listening on port ${PORT}`);
  });
}

module.exports = { app, isPublicPath, verifyJWT };