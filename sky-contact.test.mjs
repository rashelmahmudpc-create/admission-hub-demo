// Owner 2026-10-17: Sky support buttons -> /api/go/whatsapp|email, contact only in PUB_KV.
import { readFileSync } from 'node:fs';
import { handleSkyContactRequest, normalizeWhatsapp, normalizeEmail, SKY_CONTACT_KV_KEY } from './sky-contact.mjs';
let pass = 0, fail = 0;
const t = async (name, fn) => { try { if (await fn()) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } } catch (e) { fail++; console.log('  ✗', name, e && e.message); } };
const kv = (v) => ({ PUB_KV: { get: async (k) => (k === SKY_CONTACT_KV_KEY ? v : null) } });
const go = (p, env, method = 'GET') => handleSkyContactRequest(new Request('https://x.test' + p, { method }), env);
const GOOD = JSON.stringify({ whatsapp: '01712345678', email: 'help@example.org' });

await t('C-১. WhatsApp button redirects to wa.me with a ready message; local 01… gets 88', async () => {
  const r = await go('/api/go/whatsapp', kv(GOOD)); const l = r.headers.get('location');
  return r.status === 302 && l.startsWith('https://wa.me/8801712345678?text=') && decodeURIComponent(l).includes('AdmissionSky');
});
await t('C-২. email button redirects to mailto with a subject', async () => {
  const r = await go('/api/go/email', kv(GOOD));
  return r.status === 302 && r.headers.get('location').startsWith('mailto:help@example.org?subject=');
});
await t('C-৩. no-store, noindex, no-referrer on every answer', async () => {
  const r = await go('/api/go/email', kv(GOOD));
  return r.headers.get('cache-control') === 'no-store' && /noindex/.test(r.headers.get('x-robots-tag')) && r.headers.get('referrer-policy') === 'no-referrer';
});
await t('C-৪. missing / broken / invalid KV value -> 503 page, never a broken redirect', async () => {
  const a = await go('/api/go/whatsapp', kv(null)), b = await go('/api/go/email', kv('{bad')),
    c = await go('/api/go/whatsapp', kv(JSON.stringify({ whatsapp: '12', email: 'x' }))), d = await go('/api/go/email', {});
  return [a, b, c, d].every(r => r.status === 503 && !r.headers.get('location'));
});
await t('C-৫. other paths are not handled; POST is refused', async () =>
  (await go('/api/go/other', kv(GOOD))) === null && (await go('/api/ai/chat', kv(GOOD))) === null
  && (await go('/api/go/email', kv(GOOD), 'POST')).status === 405);
await t('C-৬. value checks: no script/header injection through KV', () =>
  normalizeWhatsapp('+880 1712-345678') === '8801712345678' && normalizeWhatsapp('javascript:1') === ''
  && normalizeEmail('a@b.co\r\nBcc: x@y.z') === '' && normalizeEmail('a@b.co') === 'a@b.co');
const GW = readFileSync('gk-agent-worker.js', 'utf8');
await t('C-৭. Worker routes it before the /api/* public forward', () => {
  const i = GW.indexOf('handleSkyContactRequest(request, env)'), j = GW.indexOf("url.pathname.startsWith('/pub/') || url.pathname.startsWith('/api/')");
  return GW.includes("from './sky-contact.mjs'") && i > 0 && j > i;
});
const UI = readFileSync('ai-agent-chat.js', 'utf8');
await t('C-৮. chat shows the two buttons only for support replies (m.contact)', () =>
  UI.includes("if (!m.contact || m.pending) return '';") && UI.includes('href="/api/go/whatsapp"') && UI.includes('href="/api/go/email"')
  && UI.includes('faqNote(m) + contactNote(m)') && UI.includes('contact: !!quick.contact'));
await t('C-৯. no phone number or support email in the shipped files', () =>
  ['sky-replies.json', 'sky-smalltalk.js', 'ai-agent-chat.js', 'sky-contact.mjs'].every(f => !/01[3-9]\d{8}|inflowsky|@gmail\.com/i.test(readFileSync(f, 'utf8'))));

console.log(`\n${fail ? '❌' : '✅'} Sky contact buttons: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
