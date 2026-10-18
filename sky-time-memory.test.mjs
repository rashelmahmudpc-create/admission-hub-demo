/* owner 2026-10-18: Sky's memory knows when/how to use web_search, and has a live clock + calendar. */
import { getDateTime, banglaDate, isTimeQuestion, nowLine, parseTargetDate, dhakaParts } from './sky-time.mjs';
import { planServerTools, isSimplePlan, runTools, renderToolContext, renderSimpleAnswer, TOOL_NAMES } from './sky-tools.mjs';
import { buildSystemPrompt, SYSTEM_PROMPT_V } from './ai-agent.js';
import { getPrompt, validatePromptRegistry } from './prompt-registry.js';
import { getTool } from './tool-registry.js';
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const t = async (name, fn) => { let ok = false; try { ok = await fn(); } catch (e) { console.error(e); } ok ? pass++ : fail++; console.log((ok ? '✅ ' : '❌ ') + name); };
const NOW = Date.UTC(2026, 9, 18, 0, 41); /* 2026-10-18 06:41 Dhaka */

await t('T1. prompt memory: web_search rules (when, sources, no student data, no "no internet")', () => {
  const p = buildSystemPrompt({});
  return p.includes('web_search') && p.includes('উৎস:') && p.includes('Never say you cannot browse the internet')
    && /Never put the student's name/.test(p) && !p.includes('You have no live internet access');
});
await t('T2. prompt memory: clock rules; v3 active, v2 kept deprecated', () => {
  const p = buildSystemPrompt({});
  return p.includes('get_datetime') && p.includes('NOW (Asia/Dhaka') && SYSTEM_PROMPT_V === 'sys-sky-v3-1-live-tools'
    && getPrompt('sky-core').version === 'v3' && getPrompt('sky-core-v2').status === 'deprecated'
    && getPrompt('sky-core-v2').text.includes('You have no live internet access') && validatePromptRegistry().length === 0;
});
await t('T3. Dhaka clock, weekday, English + Bangla date', () => {
  const r = getDateTime(NOW);
  return r.iso === '2026-10-18T06:41+06:00' && r.weekday === 'রবিবার' && r.date === '১৮ অক্টোবর ২০২৬'
    && r.bangla === '২ কার্তিক ১৪৩৩ বঙ্গাব্দ' && r.time === 'সকাল ৬:৪১';
});
await t('T4. Dhaka date rolls over at 18:00 UTC', () => dhakaParts(Date.UTC(2026, 9, 18, 18, 30)).d === 19 && dhakaParts(Date.UTC(2026, 9, 18, 17, 59)).d === 18);
await t('T5. Bangabda anchors: 1 বৈশাখ = 14 Apr, 1 ফাল্গুন = 14 Feb, leap Falgun 30', () => {
  const a = banglaDate(2026, 3, 14), b = banglaDate(2027, 1, 14), c = banglaDate(2027, 3, 13), d = banglaDate(2028, 2, 14);
  return a.year === 1433 && a.month === 1 && a.day === 1 && b.month === 11 && b.day === 1 && c.month === 12 && c.day === 30 && d.month === 11 && d.day === 30;
});
await t('T6. days left to a named date (Bangla / ISO / English, next year when passed)', () => {
  const p = dhakaParts(NOW);
  const a = getDateTime(NOW, '১ ডিসেম্বর আসতে কত দিন বাকি'), b = getDateTime(NOW, 'days left until 2027-01-01');
  const c = parseTargetDate('March 5', p);
  return a.daysLeft === 44 && b.daysLeft === 75 && c.y === 2027 && c.m === 2 && c.d === 5 && !getDateTime(NOW, 'এখন কয়টা বাজে').target;
});
await t('T7. time questions are recognised; study / news questions are not', () =>
  ['এখন কয়টা বাজে', 'আজ কত তারিখ', 'আজকে কি বার', 'বাংলা তারিখ কত', 'what time is it', "today's date"].every(isTimeQuestion)
  && !['সমাস কাকে বলে', 'ঢাবি ভর্তি পরীক্ষা কবে', 'সর্বশেষ খবর কী'].some(isTimeQuestion));
await t('T8. planner: time question → get_datetime, never web_search; news still searches', () => {
  const a = planServerTools('আজ কত তারিখ?', { searchOn: true }).map(x => x.name);
  const b = planServerTools('ঢাবি ভর্তি পরীক্ষার সর্বশেষ খবর কী', { searchOn: true }).map(x => x.name);
  return a.join() === 'get_datetime' && b.includes('web_search') && !b.includes('get_datetime') && planServerTools('আজ কত তারিখ', { quizMode: true }).length === 0;
});
await t('T9. a short time question is answered instantly (no model) with the live clock', async () => {
  const plan = planServerTools('এখন কয়টা বাজে?', {});
  const r = await runTools([plan], { nowMs: NOW });
  const txt = renderSimpleAnswer(r.results);
  return isSimplePlan(plan, 'এখন কয়টা বাজে?') && txt.includes('সকাল ৬:৪১') && txt.includes('রবিবার') && txt.includes('কার্তিক');
});
await t('T10. a long question gets the clock as model context instead', async () => {
  const q = 'আজ কত তারিখ? আর এই তারিখ ধরে আমার পরীক্ষার আগে কীভাবে প্রতিদিন রিভিশনের রুটিন বানাবো সেটা বিস্তারিত বলো';
  const plan = planServerTools(q, {});
  const r = await runTools([plan], { nowMs: NOW });
  return !isSimplePlan(plan, q) && renderToolContext(r.results).startsWith('TOOL get_datetime (live clock, Asia/Dhaka): রবিবার');
});
await t('T11. nowLine is one line and the chat appends it to every turn', () => {
  const l = nowLine(NOW); const src = readFileSync('ai-agent.js', 'utf8');
  return !l.includes('\n') && l.includes('2026-10-18') && /buildSystemPrompt\(\{ stats, examMode, quiz: quizMode, onboarding, prefs: aiPrefs \}\) \+ '\\n\\n' \+ nowLine\(\)/.test(src);
});
await t('T12. registry + tool list know the clock tool (read-only)', () => {
  const x = getTool('time.now');
  return TOOL_NAMES.includes('get_datetime') && x && x.permission === 'read' && x.enabled === true;
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
