/* Sign-up flow: full-screen, step-by-step, with the pet bird "স্কাই".
   This file only DRIVES the original sign-up and verification controls (it fills the real fields and clicks the real buttons),
   so the backend, validation and account rules are exactly the existing ones. If anything unexpected happens it steps aside
   and the original screens show. Add ?classic=1 to the address to turn it off. */
(() => {
'use strict';
if (window.__ahsSignup) return;
window.__ahsSignup = true;
if (/[?&]classic=1(?:&|$)/.test(location.search)) return;
const TPL = `<button class="ahs-back ahs-hide" id="ahs-back" type="button" aria-label="back"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>
<section class="ahs-petwrap">
<div class="ahs-bird" id="ahs-bird" data-m="" data-p="">
<svg class="ahs-bsvg" viewBox="0 0 240 240"><defs>
<linearGradient id="ahs-bgd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FD4FF"/><stop offset="1" stop-color="#2F6BFF"/></linearGradient>
<linearGradient id="ahs-wgd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4C8DFF"/><stop offset="1" stop-color="#2450D8"/></linearGradient>
<linearGradient id="ahs-bkd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFC233"/><stop offset="1" stop-color="#FF8A00"/></linearGradient></defs>
<ellipse class="ahs-shd" cx="120" cy="226" rx="56" ry="8" fill="rgba(11,27,58,.18)"/>
<g class="ahs-body">
<g class="ahs-tail"><path d="M104 188q-20 20-34 26 20 4 34-6z" fill="#2450D8"/><path d="M120 192q-6 24-16 34 22-6 28-30z" fill="#3A74F5"/><path d="M136 188q16 20 32 26-22 2-34-8z" fill="#2450D8"/></g>
<g class="ahs-feet"><path d="M98 196v20M86 216h24M142 196v20M130 216h24" stroke="#FF9A00" stroke-width="6" stroke-linecap="round" fill="none"/></g>
<ellipse cx="120" cy="136" rx="74" ry="68" fill="url(#ahs-bgd)"/>
<ellipse cx="96" cy="100" rx="30" ry="18" fill="#fff" opacity=".22" transform="rotate(-24 96 100)"/>
<ellipse cx="120" cy="158" rx="46" ry="40" fill="#F4FAFF"/>
<g class="ahs-tuft"><path d="M110 70q-8-22 6-30 0 14 6 24z" fill="#4C8DFF"/><path d="M122 68q4-24 20-26-6 12-8 26z" fill="#3A74F5"/></g>
<g class="ahs-head">
<circle class="ahs-chk" cx="70" cy="136" r="12" fill="#FF8FB1"/><circle class="ahs-chk" cx="170" cy="136" r="12" fill="#FF8FB1"/>
<g class="ahs-eyesN">
<g class="ahs-eyel"><ellipse cx="88" cy="116" rx="17" ry="19" fill="#fff"/><g class="ahs-pup"><circle cx="88" cy="118" r="11" fill="#14224A"/><circle cx="84" cy="112" r="4.2" fill="#fff"/><circle cx="93" cy="123" r="2" fill="#fff" opacity=".8"/></g></g>
<g class="ahs-eyer"><ellipse cx="152" cy="116" rx="17" ry="19" fill="#fff"/><g class="ahs-pup"><circle cx="152" cy="118" r="11" fill="#14224A"/><circle cx="148" cy="112" r="4.2" fill="#fff"/><circle cx="157" cy="123" r="2" fill="#fff" opacity=".8"/></g></g>
<path class="ahs-brow ahs-brw1" d="M74 92q14-9 28-2" fill="none" stroke="#1E3A8A" stroke-width="4.5" stroke-linecap="round"/><path class="ahs-brow ahs-brw2" d="M138 90q14-7 28 2" fill="none" stroke="#1E3A8A" stroke-width="4.5" stroke-linecap="round"/></g>
<g class="ahs-eyesH" fill="none" stroke="#14224A" stroke-width="5.5" stroke-linecap="round"><path d="M72 122q16-24 32 0"/><path d="M136 122q16-24 32 0"/></g>
<g class="ahs-beak"><path d="M107 132q13-6 26 0 0 6-13 14-13-8-13-14z" fill="url(#ahs-bkd)"/><g class="ahs-jawg"><path class="ahs-jaw" d="M111 143q9 14 18 0z" fill="#E8780A"/></g><ellipse class="ahs-tng" cx="120" cy="150" rx="6" ry="4" fill="#FF8FB1"/></g>
<g class="ahs-cap" transform="rotate(-6 120 52)"><path d="M120 34l62 22-62 22-62-22z" fill="#1B2A5E"/><path d="M82 64v14c0 11 76 11 76 0V64" fill="#27397F"/><g class="ahs-tas"><path d="M182 56v34" stroke="#FFB020" stroke-width="3.5" stroke-linecap="round"/><circle cx="182" cy="94" r="6" fill="#FFB020"/></g><path d="M120 46l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z" fill="#FFB020"/></g></g>
<g class="ahs-wl"><path d="M58 128q-34 8-30 46 26 2 44-22z" fill="url(#ahs-wgd)"/></g><g class="ahs-wr"><path d="M182 128q34 8 30 46-26 2-44-22z" fill="url(#ahs-wgd)"/></g>
<g class="ahs-pr ahs-cal"><rect x="176" y="150" width="46" height="44" rx="8" fill="#fff"/><rect x="176" y="150" width="46" height="14" rx="8" fill="#FF4DA6"/><g fill="#8B3DFF"><circle cx="188" cy="174" r="3"/><circle cx="199" cy="174" r="3"/><circle cx="210" cy="174" r="3"/><circle cx="188" cy="185" r="3"/><circle cx="199" cy="185" r="3"/></g></g>
<g class="ahs-pr ahs-bok"><rect x="172" y="164" width="52" height="34" rx="6" fill="#FF9F1C"/><rect x="177" y="169" width="42" height="24" rx="4" fill="#fff"/><path d="M198 169v24" stroke="#FFD08A" stroke-width="2.5"/></g>
<g class="ahs-pr ahs-mal"><rect x="172" y="160" width="54" height="38" rx="7" fill="#fff"/><path d="m175 165 24 18 24-18" fill="none" stroke="#FF6B3D" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>
<g class="ahs-pr ahs-lck"><rect x="176" y="168" width="44" height="32" rx="8" fill="#E02D7B"/><path d="M184 168v-10a14 14 0 0 1 28 0v10" fill="none" stroke="#E02D7B" stroke-width="6" stroke-linecap="round"/><circle cx="198" cy="183" r="5" fill="#fff"/></g>
<g class="ahs-pr ahs-lns"><circle cx="198" cy="170" r="16" fill="rgba(255,255,255,.6)" stroke="#5B3DF5" stroke-width="6"/><path d="m210 182 14 14" stroke="#5B3DF5" stroke-width="7" stroke-linecap="round"/></g>
<g class="ahs-pr ahs-ear" fill="none" stroke="#0A8CFF" stroke-width="5" stroke-linecap="round"><path d="M196 96q14 16 0 32"/><path d="M210 84q26 28 0 56"/></g>
</g></svg></div>
<div class="ahs-bubble" id="ahs-bubble"><span id="ahs-say"></span></div>
</section>
<section class="ahs-stage" id="ahs-stage">
<div class="ahs-scr" id="ahs-s0"><label class="ahs-fl" id="ahs-f-name"><svg class="ahs-ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg><input id="ahs-in-name" type="text" placeholder=" " autocomplete="name" enterkeyhint="done" maxlength="60"><span class="ahs-lb">তোমার পুরো নাম</span><button class="ahs-cl" type="button" data-c="in-name" aria-label="clear"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></label><div class="ahs-hint">যে নামে সনদ ও পরিচয় থাকবে সেটাই লেখো</div></div>
<div class="ahs-scr" id="ahs-s1"><div class="ahs-wheel"><i class="ahs-hl"></i><div class="ahs-col" id="ahs-c-d"></div><div class="ahs-col" id="ahs-c-m"></div><div class="ahs-col" id="ahs-c-y"></div></div><div class="ahs-age" id="ahs-age"></div></div>
<div class="ahs-scr" id="ahs-s2"><div class="ahs-lbl">তুমি এখন কোন স্তরে?</div><div class="ahs-chips" id="ahs-lv"><button class="ahs-chip" data-v="SSC" type="button">SSC</button><button class="ahs-chip" data-v="HSC" type="button">HSC</button><button class="ahs-chip" data-v="ডিপ্লোমা" type="button">ডিপ্লোমা</button><button class="ahs-chip" data-v="আলিম" type="button">আলিম</button><button class="ahs-chip" data-v="অন্যান্য" type="button">অন্যান্য</button></div>
<div id="ahs-sf" style="display:none"><div class="ahs-sp"></div><label class="ahs-fl" id="ahs-f-sch"><svg class="ahs-ic" viewBox="0 0 24 24"><path d="M3 10 12 5l9 5-9 5-9-5Z"/><path d="M7 12.5V17c3 2 7 2 10 0v-4.5"/></svg><input id="ahs-in-sch" type="text" placeholder=" " autocomplete="off" enterkeyhint="done"><span class="ahs-lb">স্কুলের নাম খোঁজো</span></label><div class="ahs-sug" id="ahs-sg-sch"></div>
<div id="ahs-cwrap"><div class="ahs-sp"></div><label class="ahs-fl" id="ahs-f-col"><svg class="ahs-ic" viewBox="0 0 24 24"><path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/></svg><input id="ahs-in-col" type="text" placeholder=" " autocomplete="off" enterkeyhint="done"><span class="ahs-lb">কলেজের নাম খোঁজো</span></label><div class="ahs-sug" id="ahs-sg-col"></div><button class="ahs-skip" id="ahs-skipc" type="button">এখনো কলেজে ভর্তি হইনি</button></div></div></div>
<div class="ahs-scr" id="ahs-s3"><label class="ahs-fl" id="ahs-f-em"><svg class="ahs-ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 6 8-6"/></svg><input id="ahs-in-em" type="email" inputmode="email" placeholder=" " autocomplete="email" autocapitalize="off" spellcheck="false" enterkeyhint="done"><span class="ahs-lb">তোমার ইমেইল</span><button class="ahs-cl" type="button" data-c="in-em" aria-label="clear"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></label><div class="ahs-chips"><button class="ahs-chip" data-d="gmail.com" type="button">@gmail.com</button><button class="ahs-chip" data-d="yahoo.com" type="button">@yahoo.com</button></div><div class="ahs-hint" id="ahs-em-h"></div></div>
<div class="ahs-scr" id="ahs-s4"><label class="ahs-fl ahs-pwf" id="ahs-f-pw"><svg class="ahs-ic" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><input id="ahs-in-pw" type="password" placeholder=" " autocomplete="new-password" enterkeyhint="done"><span class="ahs-lb">পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)</span><button class="ahs-eye" data-t="in-pw" type="button" aria-label="show"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></label><div class="ahs-meter" id="ahs-mt"><i></i><i></i><i></i><i></i></div>
<div class="ahs-sp"></div><label class="ahs-fl ahs-pwf" id="ahs-f-pw2"><svg class="ahs-ic" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/></svg><input id="ahs-in-pw2" type="password" placeholder=" " autocomplete="new-password" enterkeyhint="done"><span class="ahs-lb">পাসওয়ার্ড আবার লেখো</span></label><div class="ahs-hint" id="ahs-pw-h"></div></div>
<div class="ahs-scr" id="ahs-s5"><button class="ahs-mc ahs-sel" data-m="email" type="button"><span class="ahs-ic"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 6 8-6"/></svg></span><span><b>ইমেইল</b><small id="ahs-mm">কোড যাবে তোমার ইমেইলে</small></span><i class="ahs-rd"></i></button><button class="ahs-mc" data-m="telegram" type="button"><span class="ahs-ic"><svg viewBox="0 0 24 24"><path d="m21 4-3 15-6-4-3 3v-5L20 6 7 12 3 10Z"/></svg></span><span><b>টেলিগ্রাম</b><small>অফিসিয়াল বটে কোড আসবে</small></span><i class="ahs-rd"></i></button></div>
<div class="ahs-scr" id="ahs-s6"><div class="ahs-tgb" id="ahs-tgb" hidden><button class="ahs-tgo" id="ahs-tg-open" type="button"><svg viewBox="0 0 24 24"><path d="m21 4-3 15-6-4-3 3v-5L20 6 7 12 3 10Z"/></svg>টেলিগ্রামে বটে যাও</button><div class="ahs-hint" id="ahs-tg-st"></div></div><div class="ahs-otp ahs-hint1" id="ahs-otp"><div class="ahs-od"><input inputmode="numeric" maxlength="6" autocomplete="one-time-code" enterkeyhint="done" aria-label="1"></div><div class="ahs-od"><input inputmode="numeric" maxlength="6" enterkeyhint="done" aria-label="2"></div><div class="ahs-od"><input inputmode="numeric" maxlength="6" enterkeyhint="done" aria-label="3"></div><div class="ahs-od"><input inputmode="numeric" maxlength="6" enterkeyhint="done" aria-label="4"></div><div class="ahs-od"><input inputmode="numeric" maxlength="6" enterkeyhint="done" aria-label="5"></div><div class="ahs-od"><input inputmode="numeric" maxlength="6" enterkeyhint="done" aria-label="6"></div></div><div class="ahs-hint" id="ahs-ot-h"></div><div class="ahs-rs"><span id="ahs-rs-t"></span><button id="ahs-rs-b" type="button" disabled>আবার পাঠাও</button></div></div>
<div class="ahs-scr" id="ahs-s7"><div class="ahs-dn" id="ahs-dn"><h2 id="ahs-dn-h"></h2><p>তোমার অ্যাকাউন্ট প্রস্তুত</p><div class="ahs-ld"><u></u></div></div></div>
</section>
<footer class="ahs-foot"><button class="ahs-cta" id="ahs-cta" type="button" disabled><span id="ahs-cta-t">পরের ধাপ</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></footer>
<div class="ahs-cf" id="ahs-cf"></div>`;
const HANDLED = ['signup','created','verify','email-ownership','telegram-intro','telegram','verified','security-setup','success'];
const AFTER = ['verified','security-setup','success'];
const PAL = [['#E6F0FF','#2F6BFF','#FF9F1C'],['#F3E8FF','#8B3DFF','#FF4DA6'],['#DDF8EE','#00B386','#FFC233'],['#FFEDE3','#FF5A36','#FFB020'],['#FFE8F1','#E02D7B','#7A3CFF'],['#E8E6FF','#5B3DF5','#00C2FF'],['#DFF6FF','#0A8CFF','#00D68F'],['#FFF3D6','#FF9F1C','#2F6BFF']];
const PROP = ['','cal','bok','mal','lck','lns','ear',''];
const MON = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
const bn = n => String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
const norm = s => String(s).replace(/[০-৯]/g, c => '০১২৩৪৫৬৭৮৯'.indexOf(c)).replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/\D/g, '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const S = { name:'', d:15, m:6, y:2006, level:'', school:'', college:'', skipC:false, email:'', pw:'', pw2:'', method:'email' };
const KINDS = { school: { inp:'#ah-signup-school', res:'#ah-school-results', mine:'in-sch', sug:'sg-sch', f:'f-sch' }, college: { inp:'#ah-signup-college', res:'#ah-college-results', mine:'in-col', sug:'sg-col', f:'f-col' } };
let page = null, root = null, bird = null, cta = null, back = null, say = null, vv = null;
let step = 0, active = false, session = false, busy = false, broken = false, mode = 'email', lastView = '', entered = false;
let tT = 0, idleT = 0, mT = 0, hovT = 0, pollT = 0, subT = 0, advT = 0, advN = 0, advancing = false, tgWait = false, years = [];
const wheels = {};
const q = id => root.querySelector('#ahs-' + id);
const real = sel => page.querySelector(sel);
const role = name => page.querySelector('[data-role="' + name + '"]');
const vw = name => page.querySelector('[data-view="' + name + '"]');
const curView = () => (page && page.dataset.currentView) || '';
const first = () => S.name.trim().split(/\s+/)[0] || '';
const setv = (el, v) => { if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
const okPw = p => p.length >= 8 && /[A-Z]/.test(p) && /\d/.test(p);
const TX = [
  () => 'হাই! আমি স্কাই। তোমার নাম কী?',
  () => `বাহ্, সুন্দর নাম, ${first()}! তোমার জন্মতারিখ কত?`,
  () => 'তুমি কোথায় পড়ো? চলো স্কুল-কলেজ খুঁজি।',
  () => 'তোমার ইমেইল ঠিকানা কী?',
  () => 'এবার শক্ত একটা পাসওয়ার্ড বানাও। আমি দেখব না, কথা দিচ্ছি!',
  () => curView() === 'created' ? 'অ্যাকাউন্ট তৈরি হয়ে গেছে! কীভাবে নিশ্চিত হতে চাও?' : 'শেষ ধাপ! কীভাবে নিশ্চিত হতে চাও?',
  () => mode === 'email' ? 'কোডটা তোমার ইমেইলে গেছে। ঘরে ট্যাপ করে লিখে ফেলো!' : 'টেলিগ্রামে বটে START চেপে কোডটা নাও, তারপর এখানে লেখো!',
  () => first() ? `দারুণ! স্বাগতম, ${first()}!` : 'দারুণ! স্বাগতম!'
];
/* ---- keyboard: it must always be able to go down ---- */
const hideKb = () => { const a = document.activeElement; if (a && a.tagName === 'INPUT' && root && root.contains(a)) a.blur(); };
/* ---- bird ---- */
const mood = m => { if (bird) bird.dataset.m = m || ''; };
const look = (x, y) => { if (bird) { bird.style.setProperty('--lx', x + 'px'); bird.style.setProperty('--ly', y + 'px'); } };
const kick = (c, ms) => { if (!bird) return; const k = 'ahs-' + c; bird.classList.remove(k); void bird.offsetWidth; bird.classList.add(k); setTimeout(() => bird && bird.classList.remove(k), ms || 700); };
const talk = t => { clearInterval(tT); say.textContent = ''; let k = 0; bird.classList.add('ahs-talk'); tT = setInterval(() => { k++; say.textContent = t.slice(0, k); if (k >= t.length) { clearInterval(tT); bird.classList.remove('ahs-talk'); } }, 28); };
const mimic = () => { bird.classList.add('ahs-talk'); clearTimeout(mT); mT = setTimeout(() => bird.classList.remove('ahs-talk'), 240); };
const fly = r => { const a = r ? 'ahs-flyinr' : 'ahs-flyin'; bird.classList.remove('ahs-flyin', 'ahs-flyinr'); void bird.offsetWidth; bird.classList.add(a, 'ahs-flying'); setTimeout(() => bird.classList.remove('ahs-flyin', 'ahs-flyinr', 'ahs-flying'), 1250); };
const hover = () => { bird.classList.remove('ahs-hov'); void bird.offsetWidth; bird.classList.add('ahs-hov', 'ahs-flying'); setTimeout(() => bird.classList.remove('ahs-hov', 'ahs-flying'), 2250); };
const eyes = n => bird.style.setProperty('--eye', (1 + Math.min(n, 12) * .014).toFixed(3));
const follow = () => { if (window.ahBlendFollow) window.ahBlendFollow(); };
function pal(n) { const c = PAL[n]; root.style.setProperty('--ahst', c[0]); root.style.setProperty('--ahsp', c[1]); root.style.setProperty('--ahsq', c[2]); follow(); }
const idle = () => { busy = false; clearTimeout(subT); if (cta) cta.classList.remove('ahs-busy'); refresh(); };
/* ---- validation of my own step (same rules the original form enforces) ---- */
function refresh() {
  if (!root) return;
  let ok = false;
  if (step === 0) ok = S.name.trim().length >= 2;
  else if (step === 1) ok = true;
  else if (step === 2) ok = !!S.level && !!S.school && (S.level === 'SSC' || S.skipC || !!S.college);
  else if (step === 3) ok = EMAIL.test(S.email);
  else if (step === 4) ok = okPw(S.pw) && S.pw === S.pw2;
  else if (step === 5) ok = true;
  else if (step === 6) ok = [...root.querySelectorAll('#ahs-otp input')].every(x => x.value);
  cta.disabled = !ok || busy;
  cta.classList.toggle('ahs-ready', ok && !busy);
}
function showBack() {
  const v = curView();
  back.classList.toggle('ahs-hide', !((step >= 0 && step <= 4) || step === 6 || (step === 5 && v === 'telegram-intro')));
}
function go(n, quiet) {
  const prev = step; step = n; hideKb(); pal(n);
  root.querySelectorAll('.ahs-scr').forEach((e, k) => { e.classList.toggle('ahs-on', k === n); e.classList.toggle('ahs-l', k < n); });
  q('cta-t').textContent = ['পরের ধাপ','পরের ধাপ','পরের ধাপ','পরের ধাপ','অ্যাকাউন্ট তৈরি করো', S.method === 'telegram' ? 'টেলিগ্রামে এগোও' : 'কোড পাঠাও','যাচাই করো',''][n];
  cta.classList.toggle('ahs-hide', n === 7);
  bird.dataset.p = PROP[n]; mood(''); look(0, 0); eyes(0);
  if (!quiet) { fly(n < prev); talk(TX[n]()); }
  showBack(); refresh();
}
/* ---- fill the REAL fields ---- */
function applyDob() { setv(real('#ah-dob-year'), String(S.y)); setv(real('#ah-dob-month'), String(S.m)); setv(real('#ah-dob-day'), String(S.d)); }
function syncReal() {
  setv(real('#ah-signup-name'), S.name.trim());
  applyDob();
  const col = real('#ah-signup-college');
  if ((S.skipC || S.level === 'SSC') && col && col.value) setv(col, '');
  setv(real('#ah-signup-email'), S.email.trim());
  setv(real('#ah-signup-password'), S.pw);
  setv(real('#ah-signup-confirm'), S.pw2);
}
/* ---- wheel ---- */
const dim = () => new Date(S.y, S.m, 0).getDate();
function makeWheel(el, onPick) {
  let n = 0, last = -1, tm = 0, silent = false;
  const mark = k => el.querySelectorAll('.ahs-it').forEach((e, j) => e.classList.toggle('ahs-sel', j === k));
  el.addEventListener('scroll', () => {
    if (silent) return;
    const k = Math.max(0, Math.min(n - 1, Math.round(el.scrollTop / 44)));
    if (k !== last) { last = k; mark(k); kick('peck', 250); mood('wow'); look(0, -4); }
    clearTimeout(tm); tm = setTimeout(() => { onPick(k); mood(''); look(0, 0); }, 140);
  });
  return {
    render(list, sel) { n = list.length; el.innerHTML = '<div class="ahs-pad"></div>' + list.map(t => `<div class="ahs-it">${t}</div>`).join('') + '<div class="ahs-pad"></div>'; silent = true; el.scrollTop = sel * 44; last = sel; mark(sel); setTimeout(() => { silent = false; }, 80); },
    set(k) { if (el.scrollTo) el.scrollTo({ top: k * 44, behavior: 'smooth' }); else el.scrollTop = k * 44; }
  };
}
function age() { const t = new Date(), b = new Date(S.y, S.m - 1, S.d); let a = t.getFullYear() - b.getFullYear(); if (t < new Date(t.getFullYear(), S.m - 1, S.d)) a--; q('age').textContent = `${bn(S.d)} ${MON[S.m - 1]} ${bn(S.y)} · বয়স ${bn(a)} বছর`; }
function renderDays() { const list = Array.from({ length: dim() }, (_, k) => bn(k + 1)); if (S.d > list.length) S.d = list.length; wheels.d.render(list, S.d - 1); }
function setupWheels() {
  const sel = real('#ah-dob-year');
  years = [...(sel ? sel.options : [])].map(o => Number(o.value)).filter(Boolean);
  if (!years.length) { const y = new Date().getFullYear(); for (let k = y - 8; k >= y - 60; k--) years.push(k); }
  if (!years.includes(S.y)) S.y = years[Math.floor(years.length / 3)];
  wheels.d = makeWheel(q('c-d'), k => { S.d = k + 1; applyDob(); age(); });
  wheels.m = makeWheel(q('c-m'), k => { S.m = k + 1; const had = S.d; renderDays(); if (had !== S.d) applyDob(); applyDob(); age(); });
  wheels.y = makeWheel(q('c-y'), k => { S.y = years[k]; renderDays(); applyDob(); age(); });
  wheels.m.render(MON, S.m - 1); wheels.y.render(years.map(bn), years.indexOf(S.y)); renderDays(); age();
}
/* ---- institutions: mirror the real suggestions, click the real option ---- */
function mirror(kind) {
  const K = KINDS[kind], res = real(K.res), box = q(K.sug);
  const opts = res ? [...res.querySelectorAll('[role="option"]')] : [];
  box.innerHTML = '';
  if (!opts.length || res.hidden) { box.classList.remove('ahs-show'); return; }
  opts.slice(0, 6).forEach(o => {
    const b = document.createElement('button'); b.type = 'button';
    const name = ((o.querySelector('strong') || o).textContent || '').trim(), meta = ((o.querySelector('small') || {}).textContent || '').trim();
    const nb = document.createElement('b'); nb.textContent = name; b.appendChild(nb);
    if (meta) { const s = document.createElement('small'); s.textContent = meta; s.style.cssText = 'display:block;opacity:.65;font-size:12.5px'; b.appendChild(s); }
    b.addEventListener('click', () => pick(kind, o)); box.appendChild(b);
  });
  box.classList.add('ahs-show');
}
function pick(kind, option) {
  const K = KINDS[kind], inp = real(K.inp);
  option.click();
  try { inp.blur(); } catch (e) { /* hidden field */ }
  q(K.mine).value = inp.value; S[kind] = inp.value.trim();
  q(K.f).classList.add('ahs-good'); q(K.sug).classList.remove('ahs-show'); kick('hop'); hideKb(); refresh();
}
function wireInstitution(kind) {
  const K = KINDS[kind], mine = q(K.mine), res = real(K.res);
  mine.addEventListener('input', () => { S[kind] = ''; q(K.f).classList.remove('ahs-good'); setv(real(K.inp), mine.value); if (mine.value.trim().length < 2) q(K.sug).classList.remove('ahs-show'); kick('peck', 250); mimic(); look(0, 6); refresh(); });
  mine.addEventListener('focus', () => { mood('listen'); look(0, 6); }); mine.addEventListener('blur', () => { mood(''); look(0, 0); });
  q(K.sug).addEventListener('pointerdown', e => e.preventDefault());
  if (res) new MutationObserver(() => mirror(kind)).observe(res, { childList: true, attributes: true, attributeFilter: ['hidden'] });
}
/* ---- build + wire ---- */
function build() {
  root = document.createElement('div'); root.className = 'ahs'; root.id = 'ahs-root'; root.hidden = true; root.innerHTML = TPL; page.appendChild(root);
  bird = q('bird'); cta = q('cta'); back = q('back'); say = q('say');
  q('f-pw').querySelector('.ahs-lb').textContent = 'পাসওয়ার্ড';
  q('pw-h').textContent = '৮+ অক্ষর, একটি বড় ইংরেজি অক্ষর ও একটি সংখ্যা';
  root.addEventListener('pointerdown', e => { if (!e.target.closest('input,.ahs-fl,.ahs-sug,.ahs-chip,button,.ahs-col')) hideKb(); });
  q('stage').addEventListener('touchmove', hideKb, { passive: true });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); hideKb(); } });
  if (window.visualViewport) { const v = window.visualViewport; vv = () => { root.style.setProperty('--ahs-vh', v.height + 'px'); root.style.top = (v.offsetTop || 0) + 'px'; }; v.addEventListener('resize', vv); v.addEventListener('scroll', vv); vv(); }
  cta.addEventListener('click', next); back.addEventListener('click', goBack);
  root.querySelectorAll('.ahs-cl').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); const t = q(b.dataset.c); t.value = ''; t.dispatchEvent(new Event('input')); t.focus(); }));
  /* 0 name */
  const inName = q('in-name'); let nameDone = false;
  inName.addEventListener('focus', () => { mood('listen'); look(0, 6); nameDone = false; });
  inName.addEventListener('input', () => { S.name = inName.value; nameDone = false; q('f-name').classList.toggle('ahs-good', S.name.trim().length >= 2); kick('peck', 250); mimic(); mood('listen'); eyes(S.name.length); look(Math.max(-6, Math.min(6, S.name.length * .8 - 6)), 6); clearTimeout(idleT); idleT = setTimeout(() => { if (step === 0 && S.name && document.activeElement === inName) { mood('think'); look(6, -5); } }, 1700); refresh(); });
  inName.addEventListener('blur', () => { clearTimeout(idleT); if (step !== 0) return; eyes(0); look(0, 0); if (S.name.trim().length >= 2 && !nameDone) { nameDone = true; mood('happy'); kick('clap', 1500); talk(`বুঝেছি! তুমি ${first()}। কী সুন্দর নাম!`); setTimeout(() => { if (step === 0) mood(''); }, 2200); } else mood(''); });
  /* 2 school / college */
  root.querySelectorAll('#ahs-lv .ahs-chip').forEach(c => c.addEventListener('click', () => { root.querySelectorAll('#ahs-lv .ahs-chip').forEach(x => x.classList.remove('ahs-sel')); c.classList.add('ahs-sel'); S.level = c.dataset.v; q('sf').style.display = 'block'; q('cwrap').style.display = S.level === 'SSC' ? 'none' : 'block'; kick('hop'); mood('happy'); setTimeout(() => mood(''), 900); talk(S.level === 'SSC' ? 'ঠিক আছে! তোমার স্কুলটা খুঁজে নাও।' : 'দারুণ! স্কুল আর কলেজ দুটোই বলো।'); refresh(); }));
  wireInstitution('school'); wireInstitution('college');
  q('skipc').addEventListener('click', () => { S.skipC = !S.skipC; q('skipc').textContent = S.skipC ? 'ঠিক আছে, কলেজ পরে দেব ✓' : 'এখনো কলেজে ভর্তি হইনি'; q('f-col').style.opacity = S.skipC ? .4 : 1; hideKb(); refresh(); });
  /* 3 email */
  const inEm = q('in-em');
  inEm.addEventListener('focus', () => { mood('listen'); look(0, 6); }); inEm.addEventListener('blur', () => { mood(''); look(0, 0); });
  inEm.addEventListener('input', () => { S.email = inEm.value.trim(); const ok = EMAIL.test(S.email); q('f-em').classList.toggle('ahs-good', ok); q('em-h').textContent = ok ? 'চমৎকার, ঠিকানাটা ঠিক আছে' : ''; kick('peck', 250); mimic(); look(Math.max(-6, Math.min(6, S.email.length * .4 - 6)), 6); if (ok) { mood('happy'); setTimeout(() => { if (document.activeElement === inEm) mood('listen'); }, 800); } else mood('listen'); refresh(); });
  root.querySelectorAll('#ahs-s3 .ahs-chip').forEach(c => c.addEventListener('click', () => { const loc = inEm.value.split('@')[0]; inEm.value = loc + '@' + c.dataset.d; inEm.dispatchEvent(new Event('input')); kick('hop'); hideKb(); }));
  /* 4 password */
  const pw = q('in-pw'), pw2 = q('in-pw2');
  const strength = p => { let s = 0; if (p.length >= 8) s++; if (/\d/.test(p)) s++; if (/[A-Z]/.test(p)) s++; if (/[^\w]/.test(p) || p.length >= 12) s++; return p ? Math.max(1, s) : 0; };
  const pwChk = () => {
    S.pw = pw.value; S.pw2 = pw2.value; const s = strength(S.pw); q('mt').className = 'ahs-meter' + (s ? ' ahs-s' + s : '');
    const match = S.pw2 && S.pw === S.pw2, good = okPw(S.pw) && match;
    q('f-pw2').classList.toggle('ahs-good', !!good); q('f-pw2').classList.toggle('ahs-bad', !!S.pw2 && !match);
    let h = '৮+ অক্ষর, একটি বড় ইংরেজি অক্ষর ও একটি সংখ্যা';
    if (S.pw) { if (S.pw.length < 8) h = 'আরও ' + bn(8 - S.pw.length) + ' অক্ষর লাগবে'; else if (!/[A-Z]/.test(S.pw)) h = 'একটি বড় ইংরেজি অক্ষর (A–Z) লাগবে'; else if (!/\d/.test(S.pw)) h = 'একটি সংখ্যা লাগবে'; else if (S.pw2 && !match) h = 'দুটো পাসওয়ার্ড মিলছে না'; else if (match) h = 'দারুণ, মিলে গেছে!'; else h = 'এবার আবার লেখো'; }
    q('pw-h').textContent = h;
    if (good) { mood('happy'); setTimeout(() => { if (document.activeElement === pw2) mood('cover'); }, 900); }
    kick('peck', 250); refresh();
  };
  [pw, pw2].forEach(x => { x.addEventListener('input', pwChk); x.addEventListener('focus', () => mood('cover')); x.addEventListener('blur', () => mood('')); });
  root.querySelectorAll('.ahs-eye').forEach(b => { b.addEventListener('pointerdown', e => e.preventDefault()); b.addEventListener('click', () => { const t = q(b.dataset.t); t.type = t.type === 'password' ? 'text' : 'password'; mood(t.type === 'text' ? 'wow' : 'cover'); setTimeout(() => { if (document.activeElement === t && t.type === 'password') mood('cover'); }, 500); }); });
  /* 5 method */
  root.querySelectorAll('.ahs-mc').forEach(c => c.addEventListener('click', () => { root.querySelectorAll('.ahs-mc').forEach(x => x.classList.remove('ahs-sel')); c.classList.add('ahs-sel'); S.method = c.dataset.m; q('cta-t').textContent = S.method === 'telegram' ? 'টেলিগ্রামে এগোও' : 'কোড পাঠাও'; kick('hop'); talk(S.method === 'email' ? 'ইমেইলেই কোড পাঠাব!' : 'টেলিগ্রামে কোড পাঠাব!'); }));
  /* 6 otp (Bengali and English digits both work) */
  const ods = [...root.querySelectorAll('#ahs-otp input')], cells = [...root.querySelectorAll('#ahs-otp .ahs-od')];
  const fill = arr => ods.forEach((o, j) => { o.value = arr[j] || ''; cells[j].classList.toggle('ahs-f', !!o.value); });
  root.__fill = fill;
  ods.forEach((x, k) => {
    x.addEventListener('focus', () => { mood('listen'); look(0, 5); q('otp').classList.remove('ahs-hint1'); }); x.addEventListener('blur', () => { if (step === 6) mood(''); });
    x.addEventListener('input', () => { const d = norm(x.value); if (d.length > 1) { const arr = ods.map(o => o.value); for (let j = 0; j < d.length && k + j < 6; j++) arr[k + j] = d[j]; fill(arr); ods[Math.min(k + d.length, 5)].focus(); } else { x.value = d; cells[k].classList.toggle('ahs-f', !!d); if (d && k < 5) ods[k + 1].focus(); } kick('peck', 250); mimic(); look((k - 2.5) * 2, 5); refresh(); if (ods.every(o => o.value)) verifyCode(); });
    x.addEventListener('keydown', e => { if (e.key === 'Backspace' && !x.value && k > 0) { ods[k - 1].focus(); ods[k - 1].value = ''; cells[k - 1].classList.remove('ahs-f'); refresh(); } if (e.key === 'ArrowLeft' && k > 0) ods[k - 1].focus(); if (e.key === 'ArrowRight' && k < 5) ods[k + 1].focus(); });
    x.addEventListener('paste', e => { const d = norm((e.clipboardData && e.clipboardData.getData('text')) || '').slice(0, 6); if (!d) return; e.preventDefault(); fill(d.split('')); ods[Math.min(d.length, 5)].focus(); refresh(); if (d.length === 6) verifyCode(); });
  });
  q('rs-b').addEventListener('click', () => { const b = role(mode === 'email' ? 'ownership-resend' : 'telegram-resend'); if (b && !b.disabled) { b.click(); kick('hop'); talk('নতুন কোডের জন্য বলে দিলাম!'); } });
  q('tg-open').addEventListener('click', () => { const a = role('telegram-link'); if (a && a.getAttribute('href') && a.getAttribute('href') !== '#') a.click(); else q('tg-st').textContent = 'লিংক তৈরি হচ্ছে, একটু অপেক্ষা করো…'; });
  /* the real app talks through one message line; show its errors in the bubble */
  const m = role('message');
  if (m) new MutationObserver(onMessage).observe(m, { attributes: true, childList: true, characterData: true, subtree: true });
  setupWheels();
}
/* ---- driving the real flow ---- */
function next() {
  if (cta.disabled || busy) return; hideKb();
  if (step <= 3) { go(step + 1); return; }
  if (step === 4) { submitSignup(); return; }
  if (step === 5) { chooseMethod(); return; }
  if (step === 6) verifyCode();
}
function goBack() {
  if (step === 0) { const c = role('close'); if (c) c.click(); return; }
  if (step >= 1 && step <= 4) { go(step - 1); return; }
  if (step === 6) { const b = role(mode === 'email' ? 'ownership-back' : 'telegram-email-back'); if (b) b.click(); return; }
  if (step === 5 && curView() === 'telegram-intro') { const b = role('telegram-intro-back'); if (b) b.click(); }
}
function submitSignup() {
  syncReal(); busy = true; cta.disabled = true; cta.classList.add('ahs-busy');
  vw('signup').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  clearTimeout(subT); subT = setTimeout(idle, 20000);
}
function chooseMethod() {
  busy = true; cta.disabled = true; cta.classList.add('ahs-busy');
  let b;
  if (S.method === 'email') b = curView() === 'created' ? role('created-continue') : role('email-ownership-start');
  else b = role('telegram-verification-start');
  if (!b) { idle(); return; }
  clearTimeout(subT); subT = setTimeout(idle, 15000); b.click();
}
function verifyCode() {
  if (busy) return;
  const ods = [...root.querySelectorAll('#ahs-otp input')], code = ods.map(o => o.value).join('');
  if (code.length < 6) return;
  const input = real(mode === 'email' ? '#ah-ownership-code' : '#ah-telegram-code'), form = vw(mode === 'email' ? 'email-ownership' : 'telegram');
  if (!input || !form) return;
  busy = true; cta.disabled = true; cta.classList.add('ahs-busy'); hideKb();
  setv(input, code);
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  clearTimeout(subT); subT = setTimeout(idle, 20000);
}
function onMessage() {
  if (!active) return;
  const m = role('message'); if (!m || m.hidden) return;
  const t = (m.textContent || '').trim(); if (!t || m.dataset.kind !== 'error') return;
  const wasBusy = busy; idle(); mood('sad'); kick('shake'); talk(t); setTimeout(() => { if (step !== 7) mood(''); }, 1600);
  if (step === 6) { const o = q('otp'); o.classList.remove('ahs-bad'); void o.offsetWidth; o.classList.add('ahs-bad'); setTimeout(() => { o.classList.remove('ahs-bad'); root.__fill([]); refresh(); }, 900); }
  else if (step === 4 && wasBusy) { const cur = (vw('signup') && vw('signup').dataset.signupCurrentStep) || ''; if (cur === 'personal') go(0, true); else if (cur === 'school' || cur === 'college') go(2, true); else if (/email|ইমেইল|ই-মেইল/i.test(t)) go(3, true); }
}
/* ---- which real screen are we on? ---- */
function eligible(v) {
  if (!HANDLED.includes(v)) return false;
  if (v === 'verify') { const e = vw('verify'); return !!e && e.dataset.mode === 'select'; }
  if (AFTER.includes(v)) return session;
  return true;
}
function activate() {
  if (!root) build();
  active = true; root.hidden = false; page.classList.add('ahs-on');
  clearInterval(hovT); hovT = setInterval(() => { const a = document.activeElement; if (step < 7 && !busy && !(a && a.tagName === 'INPUT')) hover(); }, 9500);
  clearInterval(pollT); pollT = setInterval(poll, 600);
  if (window.ahBlendSchedule) window.ahBlendSchedule();
}
function deactivate() {
  active = false; if (root) root.hidden = true; if (page) page.classList.remove('ahs-on');
  clearInterval(hovT); clearInterval(pollT); clearTimeout(subT); clearTimeout(advT); advancing = false; advN = 0; lastView = ''; busy = false;
  if (window.ahBlendSchedule) window.ahBlendSchedule();
}
function poll() {
  if (!active || step !== 6) return;
  const rb = role(mode === 'email' ? 'ownership-resend' : 'telegram-resend');
  if (rb) { q('rs-b').disabled = !!rb.disabled; q('rs-t').textContent = rb.disabled ? 'কোড পাওনি? একটু অপেক্ষা করো ' : 'কোড পাওনি? '; }
  if (mode === 'telegram') { const st = role('telegram-status'); if (st && st.textContent.trim()) q('tg-st').textContent = st.textContent.trim(); }
}
function enter(v) {
  if (v === 'signup') { session = true; if (!entered) { entered = true; const nm = real('#ah-signup-name'); if (nm && nm.value) { S.name = nm.value; q('in-name').value = nm.value; q('f-name').classList.add('ahs-good'); } go(0); } else go(step <= 4 ? step : 4, true); return; }
  if (v === 'created' || v === 'verify') { session = true; showMethod(v); return; }
  if (v === 'email-ownership') { session = true; mode = 'email'; setupOtp(); return; }
  if (v === 'telegram-intro') { session = true; tgWait = true; go(5, true); idle(); busy = true; cta.disabled = true; cta.classList.add('ahs-busy'); talk('টেলিগ্রাম প্রস্তুত করছি…'); showBack(); setTimeout(() => { const c = role('telegram-intro-continue'); if (c && curView() === 'telegram-intro') c.click(); }, 250); return; }
  if (v === 'telegram') { session = true; mode = 'telegram'; setupOtp(); return; }
  celebrate();
}
function showMethod(v) {
  tgWait = false; go(5); idle();
  const vs = vw('verify'), eb = root.querySelector('.ahs-mc[data-m="email"]'), tb = root.querySelector('.ahs-mc[data-m="telegram"]');
  const eAvail = v === 'created' ? true : !(role('email-ownership-start') || {}).hidden, tAvail = v === 'created' ? true : !(role('telegram-verification-start') || {}).hidden;
  eb.hidden = !eAvail; tb.hidden = !tAvail;
  if (!eAvail && !tAvail) { broken = false; session = true; deactivate(); return; }
  if (!eAvail) S.method = 'telegram'; else if (!tAvail) S.method = 'email';
  root.querySelectorAll('.ahs-mc').forEach(x => x.classList.toggle('ahs-sel', x.dataset.m === S.method));
  q('cta-t').textContent = S.method === 'telegram' ? 'টেলিগ্রামে এগোও' : 'কোড পাঠাও';
  const em = S.email || ((role('created-email') || {}).textContent || '').trim();
  q('mm').textContent = em ? 'কোড যাবে ' + em : 'কোড যাবে তোমার ইমেইলে';
  void vs;
}
function setupOtp() {
  tgWait = false; go(6); idle(); root.__fill([]); q('otp').className = 'ahs-otp ahs-hint1';
  q('tgb').hidden = mode !== 'telegram';
  const mask = (role('ownership-mask') || {}).textContent;
  q('ot-h').textContent = mode === 'email' ? 'কোড গেছে ' + ((mask || '').trim() || S.email || 'তোমার ইমেইলে') : '';
  q('tg-st').textContent = mode === 'telegram' ? (((role('telegram-status') || {}).textContent) || '').trim() : '';
  poll(); showBack();
}
function celebrate() {
  session = true; mode = mode || 'email'; go(7); mood('cheer'); kick('loop', 1800);
  q('dn-h').textContent = first() ? 'স্বাগতম, ' + first() + '!' : 'স্বাগতম!';
  confetti(); setTimeout(confetti, 1000);
  if (!advancing) { advancing = true; advN = 0; clearTimeout(advT); advT = setTimeout(advance, 3200); }
}
function advance() {
  if (!active && !page.hidden && !AFTER.includes(curView())) return;
  const v = curView();
  const b = v === 'verified' ? role('verified-continue') : v === 'security-setup' ? role('setup-skip') : v === 'success' ? role('enter-app') : null;
  advN++;
  if (b) b.click();
  if (page.hidden) return;
  if (advN >= 7) { deactivate(); return; }
  advT = setTimeout(advance, 1000);
}
function confetti() { const cf = q('cf'), c = ['#2F6BFF', '#FF9F1C', '#00B386', '#E02D7B', '#8B3DFF']; for (let k = 0; k < 46; k++) { const e = document.createElement('i'); e.style.left = Math.random() * 100 + '%'; e.style.background = c[k % 5]; e.style.setProperty('--d', (1.8 + Math.random() * 1.6) + 's'); e.style.setProperty('--x', (Math.random() * 120 - 60) + 'px'); e.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg'); cf.appendChild(e); setTimeout(() => e.remove(), 3600); } }
function sync() {
  if (broken || !page) return;
  try {
    const v = curView();
    if (page.hidden) { session = false; entered = false; if (active) deactivate(); return; }
    if (v === 'welcome' || v === 'login' || v === 'signed') { session = false; entered = false; }
    const on = eligible(v);
    if (!on) { if (active) deactivate(); return; }
    if (!active) activate();
    if (v !== lastView) { lastView = v; enter(v); }
  } catch (error) {
    broken = true; try { deactivate(); } catch (e) { /* ignore */ }
    console.warn('[signup-flow] Original sign-up screens restored:', error && error.message);
  }
}
function init() {
  page = document.getElementById('ah-account-page');
  if (!page || !vw('signup')) return false;
  new MutationObserver(sync).observe(page, { attributes: true, attributeFilter: ['hidden', 'data-current-view'] });
  sync(); return true;
}
if (!init()) {
  const finder = new MutationObserver(() => { if (init()) finder.disconnect(); });
  finder.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => finder.disconnect(), { once: true });
}
})();
