import crypto from 'crypto';
import path from 'path';

const PUBLIC_PATHS = new Set(['/terms', '/terms.html', '/api/terms', '/api/status', '/favicon.ico']);

const safeEqual = (a, b) =>
  crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a).digest(),
    crypto.createHash('sha256').update(b).digest()
  );

function isPublic(reqPath) {
  if (PUBLIC_PATHS.has(reqPath)) return true;
  let decoded;
  try { decoded = decodeURIComponent(reqPath); } catch (_) { return false; }
  // Bot media is public, but members' payment screenshots are not
  return decoded.startsWith('/assets/') && !path.posix.basename(decoded).toLowerCase().startsWith('proof_');
}

// HTTP Basic protection for the dashboard and its APIs, enabled by ADMIN_PASSWORD
export function adminAuth(req, res, next) {
  // Behind the multi-client hub, only the hub (which has checked the login) may call this process
  const internalKey = process.env.INTERNAL_KEY;
  if (internalKey) {
    if (safeEqual(String(req.headers['x-internal-key'] || ''), internalKey)) return next();
    return res.status(403).send('Forbidden');
  }
  const password = (process.env.ADMIN_PASSWORD || '').trim();
  if (!password || isPublic(req.path)) return next();

  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const supplied = decoded.slice(decoded.indexOf(':') + 1);
    if (safeEqual(supplied, password)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Bot Admin"').status(401).send('Authentication required');
}

export function warnIfUnprotected() {
  if (!process.env.INTERNAL_KEY && !(process.env.ADMIN_PASSWORD || '').trim()) {
    console.warn('⚠️ ADMIN_PASSWORD is not set: anyone who can reach this port can change settings and approve payments.');
  }
}
