/* Owner 2026-10-17: the support buttons in Sky's replies ("WhatsApp-এ লিখো",
 * "ইমেল করো") open GET /api/go/whatsapp and /api/go/email. The real number and
 * address live only in PUB_KV under 'sky:contact' as
 *   {"whatsapp":"8801XXXXXXXXX","email":"name@example.com"}
 * so they are never in the app bundle or in this public repo, and can be changed
 * without a deploy. Missing or invalid values answer a small "not available"
 * page instead of a broken redirect. Read-only; no user data is touched. */
export const SKY_CONTACT_KV_KEY = 'sky:contact';
export const SKY_CONTACT_PATHS = Object.freeze(['/api/go/whatsapp', '/api/go/email']);
const WA_TEXT = 'আসসালামু আলাইকুম, AdmissionSky অ্যাপ থেকে সাহায্য চাই।';
const MAIL_SUBJECT = 'AdmissionSky সাহায্য';

export function normalizeWhatsapp(v) {
  let d = String(v == null ? '' : v).replace(/[^\d]/g, '');
  if (/^01\d{9}$/.test(d)) d = '88' + d;
  return /^\d{10,15}$/.test(d) ? d : '';
}
export function normalizeEmail(v) {
  const e = String(v == null ? '' : v).trim();
  return e.length <= 120 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e) ? e : '';
}
export async function readSkyContact(env) {
  try {
    const raw = env && env.PUB_KV ? await env.PUB_KV.get(SKY_CONTACT_KV_KEY) : null;
    const j = raw ? JSON.parse(raw) : {};
    return { whatsapp: normalizeWhatsapp(j && j.whatsapp), email: normalizeEmail(j && j.email) };
  } catch (_) {
    return { whatsapp: '', email: '' };
  }
}
const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};
function unavailable() {
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>AdmissionSky</title><p style="font:16px system-ui;padding:24px">যোগাযোগের এই পথটা এখন চালু নেই। একটু পরে আবার চেষ্টা করো।</p>';
  return new Response(html, { status: 503, headers: { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
}
export async function handleSkyContactRequest(request, env) {
  const url = new URL(request.url);
  if (!SKY_CONTACT_PATHS.includes(url.pathname)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { ...BASE_HEADERS, Allow: 'GET, HEAD' } });
  }
  const c = await readSkyContact(env);
  let target = '';
  if (url.pathname === '/api/go/whatsapp' && c.whatsapp) {
    target = 'https://wa.me/' + c.whatsapp + '?text=' + encodeURIComponent(WA_TEXT);
  } else if (url.pathname === '/api/go/email' && c.email) {
    target = 'mailto:' + c.email + '?subject=' + encodeURIComponent(MAIL_SUBJECT);
  }
  if (!target) return unavailable();
  return new Response(null, { status: 302, headers: { ...BASE_HEADERS, Location: target } });
}
