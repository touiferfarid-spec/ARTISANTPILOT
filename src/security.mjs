import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.mjs';
const scrypt = promisify(crypto.scrypt);
export const token = () => crypto.randomBytes(32).toString('hex');
export const sha = x => crypto.createHash('sha256').update(String(x)).digest('hex');
export async function passwordHash(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 160) throw new Error('Le mot de passe doit contenir 12 à 160 caractères.');
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(value, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}
export async function passwordVerify(value, stored) {
  try {
    const [kind, salt, encoded] = String(stored).split(':');
    if (kind !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(encoded)) return false;
    const candidate = await scrypt(value, Buffer.from(salt, 'hex'), 64);
    return crypto.timingSafeEqual(candidate, Buffer.from(encoded, 'hex'));
  } catch { return false; }
}
export function encrypt(value) {
  if (!/^[a-f0-9]{64}$/i.test(config.encryptionKey)) throw new Error('Clé OAuth non configurée');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), iv);
  const result = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), body: result.toString('base64')});
}
export function decrypt(record) {
  if (!/^[a-f0-9]{64}$/i.test(config.encryptionKey)) throw new Error('Clé OAuth non configurée');
  const {iv, authTag, body} = JSON.parse(record);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8'));
}
export function cookie(tokenValue, {prod=config.prod, expire=false}={}) {
  return `artisan_session=${tokenValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expire ? 0 : 604800}${prod ? '; Secure' : ''}`;
}
export function getCookie(req, name='artisan_session') {
  const x = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(v => v.startsWith(name+'='));
  return x ? x.slice(name.length+1) : '';
}
export function trustedOrigin(req, base=config.baseUrl) {
  const origin = req.headers.origin;
  if (origin) return origin === base;
  const referer = req.headers.referer;
  if (!referer) return false;
  try {return new URL(referer).origin === base;} catch { return false; }
}
export const isEmail = v => typeof v === 'string' && v.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
export const safeCustomerId = x => /^\d{10}$/.test(String(x||'').replace(/\D/g,'')) ? String(x).replace(/\D/g,'') : null;
export function constantTimeEqual(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && crypto.timingSafeEqual(x,y)}
export function secureHeaders(extra={}) {return {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options':'DENY',
  'Referrer-Policy':'strict-origin-when-cross-origin','Cross-Origin-Resource-Policy':'same-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'",
  ...extra
};}
