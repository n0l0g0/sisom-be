/**
 * Phase 4B: Gateway that reads JWT and forwards X-Tenant-Id to sisom-backend.
 * Proxies all requests to TARGET_URL; if Authorization Bearer has valid JWT with tenant_id, adds X-Tenant-Id header.
 */
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3011;
const TARGET_URL = process.env.TARGET_URL || 'http://sisom-backend:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

const app = express();

function getToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(^| )sisom_token=([^;]+)/);
  return m ? m[2].trim() : null;
}

app.use((req, res, next) => {
  const token = getToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.tenant_id) {
        req.headers['x-tenant-id'] = decoded.tenant_id;
        if (decoded.tenant_slug) {
          req.headers['x-tenant-slug'] = decoded.tenant_slug;
        }
      }
    } catch {
      // invalid or expired token - do not set header
    }
  }
  next();
});

app.use(
  '/',
  createProxyMiddleware({
    target: TARGET_URL,
    changeOrigin: true,
    ws: true,
    onProxyReq: (proxyReq, req) => {
      if (req.headers['x-tenant-id']) {
        proxyReq.setHeader('X-Tenant-Id', req.headers['x-tenant-id']);
      }
      if (req.headers['x-tenant-slug']) {
        proxyReq.setHeader('X-Tenant-Slug', req.headers['x-tenant-slug']);
      }
    },
  })
);

app.listen(PORT, () => {
  console.log(`CMS Gateway listening on ${PORT}, forwarding to ${TARGET_URL}`);
});
