// ✅ বুট-শেল স্ট্যাটিক-কন্ট্রাক্ট টেস্ট (v189-ac3)
// ইতিহাস: v176-এ ইনলাইন 3D-splash (ahfs-scene) ছিল; v178-nosplash-এ তা ইচ্ছাকৃতভাবে বাদ
// হয়ে index.html-এ এখন JS-নির্ভরহীন বুট-শেল (#ahSplash=লোডার)। এই স্যুট বর্তমান কন্ট্রাক্ট যাচাই করে।
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';

let html = readFileSync('index.html', 'utf8');
// external scripts সরিয়ে শুধু DOM + inline content নিই (static-first proof)
html = html.replace(/<script src="[^"]*"><\/script>/g, '');
html = html.replace(/<script>\s*function([\s\S]*?)<\/script>/g, '');

// static-only scene: কোনো JS ছাড়াই
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const doc = dom.window.document;
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

const ah = doc.getElementById('ahSplash');
t('১. #ahSplash লোডার exist (JS ছাড়াই)', !!ah);
t('২. main.app-loading + role=status', ah && ah.tagName === 'MAIN' && ah.classList.contains('app-loading') && ah.getAttribute('role') === 'status');
const boot = ah && ah.querySelector('.ah-boot');
t('৩. .ah-boot শেল exist', !!boot);
t('৪. .ah-boot-mark ✦ চিহ্ন', boot && boot.querySelector('.ah-boot-mark') && boot.querySelector('.ah-boot-mark').textContent.trim() === '✦');
t('৫. ব্র্যান্ড টাইটেল "Admission Hub"', boot && boot.querySelector('b') && boot.querySelector('b').textContent.includes('Admission Hub'));
t('৬. লোডিং-কপি বাংলা "লোড হচ্ছে…"', boot && boot.querySelector('i') && boot.querySelector('i').textContent.includes('লোড হচ্ছে'));
t('৭. বুট-মিনিমাল CSS inline (ah-boot-min + keyframes ahBootPulse)', !!doc.getElementById('ah-boot-min') && doc.getElementById('ah-boot-min').textContent.includes('@keyframes ahBootPulse'));
t('৮. reduced-motion গার্ড (মোশন-সংবেদনশীল)', doc.getElementById('ah-boot-min').textContent.includes('prefers-reduced-motion'));
t('৯. পুরনো ইনলাইন-3D-splash আর নেই (v178-nosplash; ahfs-scene = 0)', !doc.querySelector('.ahfs-scene') && !html.includes('ahfs-scene'));
t('১০. app-id + #app রুট exist', !!doc.getElementById('app'));
t('১১. externl-স্ক্রিপ্ট-না-থাকলেও শেল রেন্ডার (static-first প্রমাণ)', !!doc.getElementById('app').querySelector('#ahSplash'));
t('১২. current account-retired service-worker marker', html.includes('sw.js?v=v257-profile-core-20260915'));

console.log(`\nINTRO-BOOTSHELL: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
