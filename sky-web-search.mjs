/* AdmissionSky — web_search tool (Tavily), owner 2026-10-18. Server only.
 * Kept apart from the READ-only runner (sky-tools.mjs): the only write here is
 * the shared daily call counter in PUB_KV (no user data is stored).
 * - runs only for a news / recent-facts question (isNewsQuestion)
 * - daily cap env.TAVILY_DAILY_CAP (default 50) for the whole app
 * - sends only the cleaned question (no name, email, phone, link, stats, uid)
 * - the model is told to cite the source links
 * - kill switch: PUB_KV 'sky:web-search' = "off"
 */
export const SEARCH_KV_SWITCH = 'sky:web-search';
export const SEARCH_DAILY_DEFAULT = 50;
const RE_NEWS = /(খবর|সংবাদ|সর্বশেষ|সাম্প্রতিক|সদ্য|হালনাগাদ|আপডেট|আজকে?র|আজ\s*কী|এ\s*বছরের|এই\s*বছর|চলতি|বর্তমানে?\s*(কে|কী|কি|কত)|এখন\s*(কে|কী|কি|কত)|নতুন\s*(নিয়ম|সার্কুলার|বিজ্ঞপ্তি|নোটিশ)|সার্কুলার|বিজ্ঞপ্তি|ঘোষণা|২০২[৫-৯]|202[5-9]|\b(news|latest|recent(ly)?|current(ly)?|today'?s?|this\s+year|update[sd]?|announced?|circular|notice)\b)/i;
/* personal / study questions never go to the web */
const RE_NOT_WEB = /(আমার|\bmy\b|সমাস|সন্ধি|কারক|সমীকরণ|সূত্র|অনুবাদ|translate|formula|equation)/i;
/* "when is the exam / form / result" — a date that changes every year (owner 2026-10-18).
   Needs both a when-word and an admission word, and never a past-tense history question. */
const RE_WHEN = /(কবে|কখন|তারিখ|সময়সূচ[িী]|শিডিউল|ডেডলাইন|শেষ\s*সময়|\b(when|date|dates|schedule|deadline)\b)/i;
const RE_ADMISSION = /(ভর্তি|পরীক্ষা|আবেদন|ফরম|ফর্ম|ফল\s*প্রকাশ|রেজাল্ট|বিজ্ঞপ্তি|সার্কুলার|প্রবেশপত্র|এডমিট|অ্যাডমিট|ঢাবি|জাবি|রাবি|চবি|বুয়েট|গুচ্ছ|মেডিকেল|বিশ্ববিদ্যালয়|ইউনিট|\b(admission|exam|result|application|admit\s*card|unit)\b)/i;
const RE_PAST = /(হয়েছিল|হয়েছিলো|ছিল|ছিলো|ঘটেছিল|\b(was|were|did)\b)/i;
export function isNewsQuestion(text) {
  const t = String(text || '');
  if (RE_NOT_WEB.test(t)) return false;
  if (RE_NEWS.test(t)) return true;
  return RE_WHEN.test(t) && RE_ADMISSION.test(t) && !RE_PAST.test(t);
}
/** Only the question words leave the server: no email, phone, link, long number or the student's name. */
export function cleanSearchQuery(text, firstName) {
  let q = String(text || '').slice(0, 300);
  q = q.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\d০-৯]{3,5}[\s-][\d০-৯]{3,4}[\s-][\d০-৯]{3,4}/g, ' ')
    .replace(/\+?[\d০-৯][\d০-৯-]{5,}[\d০-৯]/g, ' ');
  const n = String(firstName || '').trim();
  if (n.length >= 2) q = q.split(n).join(' ');
  q = q.replace(/\s+/g, ' ').trim().slice(0, 200);
  return q.length >= 3 ? q : '';
}
async function searchEnabled(kv) {
  if (!kv || typeof kv.get !== 'function') return true;
  try { const v = await kv.get(SEARCH_KV_SWITCH); return String(v || '').trim().toLowerCase() !== 'off'; } catch (_) { return true; }
}
const dayKey = (now) => 'sky:web-search:count:' + new Date(now || Date.now()).toISOString().slice(0, 10);
/** Daily cap shared by all users. Returns true when this call may go out. */
export async function takeSearchQuota(kv, cap, now) {
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') return false;
  const key = dayKey(now);
  const used = Number(await kv.get(key)) || 0;
  if (used >= cap) return false;
  await kv.put(key, String(used + 1), { expirationTtl: 172800 });
  return true;
}
const safeUrl = (u) => { try { const x = new URL(String(u)); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch (_) { return ''; } };
export async function webSearch(query, ctx = {}) {
  const env = ctx.env || {};
  const key = String(env.TAVILY_API_KEY || '').trim();
  if (!key) return { ok: false, error: 'no-key' };
  const q = cleanSearchQuery(query, ctx.firstName);
  if (!q) return { ok: false, error: 'empty-query' };
  if (!(await searchEnabled(ctx.kv))) return { ok: false, error: 'off' };
  const cap = Math.max(0, Math.min(1000, Number(env.TAVILY_DAILY_CAP) || SEARCH_DAILY_DEFAULT));
  if (!(await takeSearchQuota(ctx.kv, cap, ctx.now))) return { ok: false, error: 'daily-limit' };
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ query: q, topic: 'general', search_depth: 'basic', max_results: 4, include_answer: false, include_raw_content: false, include_images: false })
  });
  if (!res || !res.ok) return { ok: false, error: 'http-' + (res && res.status) };
  const j = await res.json().catch(() => null);
  const results = (j && Array.isArray(j.results) ? j.results : []).map((r) => ({
    title: String(r && r.title || '').slice(0, 160), url: safeUrl(r && r.url), snippet: String(r && r.content || '').replace(/\s+/g, ' ').slice(0, 400)
  })).filter((r) => r.url).slice(0, 4);
  return { ok: true, query: q, results };
}
export function renderSearchContext(r) {
  const lines = r.results.map((x, i) => (i + 1) + '. ' + x.title + ' — ' + x.snippet + ' (' + x.url + ')');
  return 'TOOL web_search (live web, ' + new Date().toISOString().slice(0, 10) + '): results for "' + r.query + '":\n' + lines.join('\n') +
    '\nUse only these results for recent facts; if they do not answer, say so. End the answer with a short "উৎস:" list of the links you used, as Markdown links [title](url).';
}
