(() => {
  'use strict';
  const weekdays = ['রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার'];
  const months = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
  const digits = n => String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
  function greeting(h) { if (h >= 4 && h < 6) return 'শুভ ভোর 🌅'; if (h < 12) return 'শুভ সকাল ☀️'; if (h < 15) return 'শুভ দুপুর 🌤️'; if (h < 17) return 'শুভ বিকাল 🌇'; if (h < 20) return 'শুভ সন্ধ্যা 🌆'; return 'শুভ রাত্রি 🌙'; }
  function clockText(input = new Date()) { const d=input instanceof Date?input:new Date(input||Date.now()); const safe=Number.isNaN(d.getTime())?new Date():d; let h=safe.getHours(), m=safe.getMinutes(); const period=h<4||h>=20?'রাত':h<6?'ভোর':h<12?'সকাল':h<15?'দুপুর':h<17?'বিকাল':'সন্ধ্যা'; const display=h%12||12; return `${weekdays[safe.getDay()]}, ${digits(safe.getDate())} ${months[safe.getMonth()]} ${digits(safe.getFullYear())} | ${period} ${digits(display)}:${digits(String(m).padStart(2,'0'))}`; }
  function isDashboardPage() {
    try { return !!(document.querySelector('.dashboard-v2,.p3-dashboard-v3')) || (window.Router && (Router.path === '' || Router.path === 'dashboard')); } catch(_) { return false; }
  }
  function update() { const root=document.querySelector('.dashboard-v2,.p3-dashboard-v3,.page'); if (!root) return; if (!isDashboardPage()) return; const header=root.querySelector('.dashboard-header,.p3-header-v3,.p3-header-text')||root; const h1=header.querySelector('h1,h2'); const d=new Date(); if(h1)h1.textContent=greeting(d.getHours())+', Scholar'; let p=header.querySelector('.p3-live-clock'); if(!p && root.matches('.p3-dashboard-v3,.page')) { p=document.createElement('p'); p.className='p3-live-clock'; p.style.cssText='margin:4px 0 0;color:#78958c;font-size:12px;line-height:1.5'; h1?.insertAdjacentElement('afterend',p); } if(!p) p=header.querySelector('.dashboard-header p'); if(p) p.textContent=clockText(d); }
  const previous = window.renderDashboard;
  if (typeof previous === 'function') { window.renderDashboard = function(){ const out=previous.apply(this,arguments); setTimeout(update,0); return out; }; }
  window.updateDashboardGreeting = update;
  setInterval(update, 60000);
  setTimeout(update, 0);
})();

  (() => { let n=0; const reconcile=setInterval(() => { n++; if (document.querySelector('.dashboard-v2,.p3-dashboard-v3,.page')) window.updateDashboardGreeting(); if (n >= 20) clearInterval(reconcile); }, 100); })();
