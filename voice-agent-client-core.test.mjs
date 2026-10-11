// 🎙️ P23 — Voice agent client core guards.
// Locks the endpoint choice, the microphone request, the recorder container and
// the phase labels, so the page shell has nothing left to get wrong.
import { readFileSync } from 'fs';
import {
  DEFAULT_WORKER, VOICE_PATH, isSameWorkerOrigin, resolveEndpoint,
  resolveTicketUrl, withTicket, ticketHeaders,
  micConstraints, MIME_PREFERENCE, pickMime, PHASE, bytesToBase64,
  phaseLabel, formatLatency, validateVoiceClientCore,
} from './voice-agent-client-core.mjs';

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

t('P23-৫৭. client core self-validation is clean', validateVoiceClientCore().length === 0);

/* ── Endpoint ── */
t('P23-৫৮. the default endpoint is the Worker socket path',
  DEFAULT_WORKER === 'https://admission-gk.admissionhub.workers.dev' && VOICE_PATH === '/api/voice/agent');
t('P23-৫৯. a Pages page dials its own origin, so the session cookie travels',
  resolveEndpoint('https://admissionhub.pages.dev/index.html') === 'wss://admissionhub.pages.dev/api/voice/agent');
t('P23-৬০. a page on the Worker origin talks to itself, surviving a rename',
  resolveEndpoint('https://admission-gk.admissionhub.workers.dev/x') === 'wss://admission-gk.admissionhub.workers.dev/api/voice/agent'
  && isSameWorkerOrigin('https://admission-gk.admissionhub.workers.dev/x'));
t('P23-৬১. a local page talks to itself over ws, and a non-http page falls back to the Worker',
  resolveEndpoint('http://localhost:8787/x', 'http://localhost:8787') === 'ws://localhost:8787/api/voice/agent'
  && resolveEndpoint('file:///tmp/x.html') === 'wss://admission-gk.admissionhub.workers.dev/api/voice/agent');
t('P23-৬২. an explicit override wins, so staging needs no code change',
  resolveEndpoint('https://admissionhub.pages.dev/', DEFAULT_WORKER, 'https://staging.example.workers.dev')
    === 'wss://staging.example.workers.dev/api/voice/agent');
t('P23-৬৩. a malformed page URL cannot throw',
  typeof resolveEndpoint('not-a-url') === 'string' && resolveEndpoint('not-a-url').startsWith('wss://'));

/* ── Ticket handshake ── */
t('P23-৬৪. the ticket endpoint sits beside the socket on the same origin',
  resolveTicketUrl('https://admissionhub.pages.dev/') === 'https://admissionhub.pages.dev/api/voice/agent/ticket'
  && resolveTicketUrl('https://admission-gk.admissionhub.workers.dev/x') === 'https://admission-gk.admissionhub.workers.dev/api/voice/agent/ticket');
t('P23-৬৫. the ticket request carries the app header the worker already gates on',
  ticketHeaders()['X-AH-App'] === 'admission-hub' && !('X-Voice-Token' in ticketHeaders()));
t('P23-৬৬. an access token is only sent when one is configured',
  ticketHeaders('tok')['X-Voice-Token'] === 'tok');
t('P23-৬৭. a ticket rides on the socket URL as a query parameter',
  withTicket('wss://w.dev/api/voice/agent', 'abc123') === 'wss://w.dev/api/voice/agent?ticket=abc123'
  && withTicket('wss://w.dev/api/voice/agent', '') === 'wss://w.dev/api/voice/agent');
t('P23-৬৮. a malformed socket URL is returned unchanged rather than throwing',
  withTicket('not a url', 't') === 'not a url');

/* ── Microphone ── */
t('P23-৬৯. the mic is requested mono with the three call filters on',
  (() => { const c = micConstraints(); return c.audio.channelCount === 1 && c.audio.echoCancellation
    && c.audio.noiseSuppression && c.audio.autoGainControl && c.video === false; })());
t('P23-৭০. no camera is ever requested', micConstraints().video === false);

/* ── Recorder container ── */
t('P23-৭১. Opus-in-WebM is preferred when the browser supports it',
  pickMime(['audio/webm;codecs=opus', 'audio/mp4']) === 'audio/webm;codecs=opus');
t('P23-৭২. Safari falls back to mp4',
  pickMime(['audio/mp4']) === 'audio/mp4');
t('P23-৭৩. a codec-less webm report still resolves',
  pickMime(['audio/webm']) === 'audio/webm');
t('P23-৭৪. an unsupported browser yields null instead of a bad type',
  pickMime([]) === null && pickMime(undefined) === null && pickMime(null) === null);
t('P23-৭৫. the preference list is frozen so a caller cannot reorder it',
  Object.isFrozen(MIME_PREFERENCE) && MIME_PREFERENCE[0].includes('opus'));

/* ── Phases ── */
t('P23-৭৬. every phase has a Bengali label',
  Object.values(PHASE).every(p => phaseLabel(p).length > 0));
t('P23-৭৭. an unknown phase has no label rather than a wrong one',
  phaseLabel('wat') === '');
t('P23-৭৮. the ready phase invites a single tap, not a press-and-hold', phaseLabel(PHASE.READY).includes('চাপ দিয়ে') && !phaseLabel(PHASE.READY).includes('চেপে ধরে'));

/* ── Latency line ── */
t('P23-৭৯. latency shows only the stages that were measured',
  (() => { const s = formatLatency({ stt: 280, llm: 480, tts: 390, total: 1250 });
    return s.includes('শোনা') && s.includes('ভাবা') && s.includes('কণ্ঠ') && s.includes('মোট'); })());
t('P23-৮০. a missing stage is omitted, not shown as zero',
  (() => { const s = formatLatency({ stt: 200, total: 900 }); return s.includes('শোনা') && !s.includes('ভাবা'); })());
t('P23-৮১. no measurement yields an empty line',
  formatLatency(null) === '' && formatLatency({}) === '');

/* ── Payload ── */
t('P23-৮২. bytes encode to base64 that decodes back to the same bytes',
  (() => {
    const src = new Uint8Array([0, 1, 2, 250, 255]);
    const b64 = bytesToBase64(src);
    return Buffer.from(b64, 'base64').equals(Buffer.from(src));
  })());
t('P23-৮৩. a large clip encodes without blowing the stack (chunked)',
  (() => { const big = new Uint8Array(200000).fill(7); return Buffer.from(bytesToBase64(big), 'base64').length === 200000; })());

/* ── The page itself ── */
{
  const src = readFileSync('voice-agent.html', 'utf8');
  t('P23-৮৪. the page has a push-to-talk control and a transcript area',
    /id="talk"/.test(src) && /id="log"/.test(src));
  t('P23-৮৫. the page never stores a provider key in the browser',
    !/localStorage[\s\S]{0,80}(CARTESIA|ELEVENLABS|GROQ|API_KEY)/.test(src) && !/sk-[A-Za-z0-9]{20,}/.test(src));
  t('P23-৮৬. the page names the owner as স্যার',
    src.includes('স্যার'));
  t('P23-৮৭. the page asks for the mic on tap and a second tap stops it',
    /getUserMedia/.test(src) && /addEventListener\('click'/.test(src) &&
    /function toggleTalk/.test(src) && !/pointerdown/.test(src));
  t('P23-৮৮. the page surfaces a latency line rather than hiding it',
    /formatLatency|লেটেন্সি|মোট/.test(src));
  t('P23-৮৯. the page sends the owner to the password page when the cookie is gone',
    /status === 401/.test(src) && /location\.replace\('\/voice-agent-login'\)/.test(src));

  /* ── The PWA shell and the gate page ── */
  const login = readFileSync('voice-agent-login.html', 'utf8');
  const manifest = readFileSync('voice-agent.webmanifest', 'utf8');
  const worker = readFileSync('_worker.js', 'utf8');

  t('P23-৯০. the login page posts the password to the worker, never stores it',
    /\/api\/voice\/login/.test(login) && /type="password"/.test(login) &&
    !/localStorage/.test(login));
  t('P23-৯১. the voice page is installable (manifest + iOS meta + theme)',
    /rel="manifest" href="\/voice-agent\.webmanifest"/.test(src) &&
    /apple-mobile-web-app-capable/.test(src) && /name="theme-color"/.test(src));
  t('P23-৯২. the manifest is standalone, scoped to the page, with real icons',
    JSON.parse(manifest).display === 'standalone' &&
    JSON.parse(manifest).scope === '/voice-agent' &&
    JSON.parse(manifest).icons.length >= 2);
  t('P23-৯৩. Pages routes the voice page and its login, or the gate has no page',
    worker.includes("'/voice-agent'") && worker.includes("'/voice-agent-login'") &&
    worker.includes("'/voice-agent.html'") && worker.includes('AGENT_API'));
  t('P23-৯৪. the page is not indexable, so the owner page stays private',
    /noindex/.test(src) && /noindex/.test(login));
}

console.log(`\n  voice-agent client: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
