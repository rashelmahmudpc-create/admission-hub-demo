(() => {
  'use strict';
  window.__settingsCommandCleanupLoaded = true;

  // The user removed AI settings. Clear only this app's former provider preferences and keys.
  ['ai_provider', 'gemini_api_key', 'groq_api_key', 'gemini_api_key_model', 'groq_api_key_model'].forEach(key => {
    try { localStorage.removeItem(key); } catch (_) {}
  });
  /* agent-f1: লিগ্যাসি AIChatState আর নেই (Phase-1 Agent Core) */

  const feedbackSettings = () => {
    const base = typeof window.phaseSettingsWithFeedback === 'function'
      ? window.phaseSettingsWithFeedback(CACHE.settings)
      : (CACHE.settings || {});
    base.feedback = Object.assign({ visual: true, success: true, error: true }, base.feedback || {});
    return base;
  };

  function removeHeadingAndCard(app, title) {
    const heading = [...app.querySelectorAll('.h2')].find(node => node.textContent.trim().toLowerCase() === title.toLowerCase());
    if (!heading) return;
    const card = heading.nextElementSibling;
    heading.remove();
    if (card?.classList?.contains('card')) card.remove();
  }

  function feedbackPanel(app) {
    // The app observer watches this subtree. Replacing an existing panel on every
    // mutation creates an endless remove/add loop and freezes Settings on mobile.
    if (app.querySelector('#admission-feedback-controls')) return;
    app.querySelector('#phase-feedback-controls')?.remove();
    [...app.querySelectorAll('.togglerow')].forEach(row => {
      const label = row.querySelector(':scope > span')?.textContent?.trim().toLowerCase();
      if (['visual feedback', 'success effects', 'error effects'].includes(label)) row.remove();
    });

    const s = feedbackSettings();
    const row = (key, title, detail) => `<div class="togglerow"><div><b>${title}</b><div class="muted">${detail}</div></div><button type="button" data-feedback-toggle="${key}" role="switch" aria-checked="${s.feedback[key] === true}" class="toggle ${s.feedback[key] === true ? 'on' : ''}" onclick="toggleFeedbackSetting('${key}')"><div class="dot"></div></button></div>`;
    const panel = document.createElement('section');
    panel.id = 'admission-feedback-controls';
    panel.innerHTML = `<div class="h2">Feedback controls</div><div class="card" aria-label="Feedback settings">${row('visual', 'Visual Feedback', 'Show correct and wrong answer states in Flash Test.')}${row('success', 'Success Effects', 'Show a short correct-answer confirmation effect.')}${row('error', 'Error Effects', 'Show a short wrong-answer confirmation effect.')}</div>`;
    const anchor = [...app.querySelectorAll('.h2')].find(node => node.textContent.trim().toLowerCase() === 'dashboard cards');
    if (anchor) anchor.before(panel);
    else app.append(panel);
  }

  function cleanSettingsUi() {
    const app = document.getElementById('app');
    if (!app || !String(location.hash || '').includes('settings')) return;
    removeHeadingAndCard(app, 'AI Assistant');
    removeHeadingAndCard(app, 'Exam defaults');
    feedbackPanel(app);
  }

  const originalSettingsRender = window.renderSettings;
  if (typeof originalSettingsRender === 'function' && !originalSettingsRender.__settingsCleanupWrapped) {
    const wrapped = function () {
      const result = originalSettingsRender.apply(this, arguments);
      requestAnimationFrame(cleanSettingsUi);
      return result;
    };
    wrapped.__settingsCleanupWrapped = true;
    window.renderSettings = wrapped;
  }

  // Legacy settings calls the global shell directly, so clean it after the final shell pass too.
  const originalRenderShell = window.renderShell;
  if (typeof originalRenderShell === 'function' && !originalRenderShell.__settingsCleanupShellWrapped) {
    const shellWrapped = function () {
      const result = originalRenderShell.apply(this, arguments);
      if (String(window.Router?.path || '') === 'settings') requestAnimationFrame(cleanSettingsUi);
      return result;
    };
    shellWrapped.__settingsCleanupShellWrapped = true;
    window.renderShell = shellWrapped;
  }

  // The legacy app keeps its renderer in a global lexical binding rather than on window.
  // Observe the app mount so Settings cleanup also runs after that legacy renderer replaces DOM.
  const mount = () => {
    const app = document.getElementById('app');
    if (!app || app.__settingsCleanupObserved) return;
    app.__settingsCleanupObserved = true;
    new MutationObserver(() => requestAnimationFrame(cleanSettingsUi)).observe(app, { childList: true, subtree: true });
    requestAnimationFrame(cleanSettingsUi);
  };
  const scheduleSettingsCleanup = () => {
    requestAnimationFrame(cleanSettingsUi);
    window.setTimeout(cleanSettingsUi, 80);
    window.setTimeout(cleanSettingsUi, 260);
  };
  mount();
  window.addEventListener('hashchange', scheduleSettingsCleanup, { passive: true });

  window.toggleFeedbackSetting = async function (key) {
    if (!['visual', 'success', 'error'].includes(key)) return;
    const s = feedbackSettings();
    s.feedback[key] = s.feedback[key] !== true;
    CACHE.settings = s;
    await dbPut('settings', s);
    document.querySelectorAll(`[data-feedback-toggle="${key}"]`).forEach(control => {
      const on = s.feedback[key] === true;
      control.classList.toggle('on', on);
      control.setAttribute('aria-checked', String(on));
    });
    toast(`${key === 'visual' ? 'Visual feedback' : key === 'success' ? 'Success effects' : 'Error effects'} ${s.feedback[key] ? 'on' : 'off'}`);
  };

  // Respect success/error settings with a small visual confirmation after a Flash answer.
  const originalFlashSelect = window.selectFlashAnswer;
  if (typeof originalFlashSelect === 'function' && !originalFlashSelect.__feedbackCleanupWrapped) {
    const wrapped = async function (qid, index) {
      const question = window.ActiveExam?.questions?.find(item => item.id === qid);
      const correct = !!question && index === question.answerIndex;
      const result = await originalFlashSelect.apply(this, arguments);
      const s = feedbackSettings();
      if (s.feedback.visual !== false && ((correct && s.feedback.success === true) || (!correct && s.feedback.error === true))) {
        requestAnimationFrame(() => {
          const selected = document.querySelectorAll('.flash-container .opt')[index];
          if (selected) selected.classList.add(correct ? 'admission-feedback-success' : 'admission-feedback-error');
        });
      }
      return result;
    };
    wrapped.__feedbackCleanupWrapped = true;
    window.selectFlashAnswer = wrapped;
  }

  const style = document.createElement('style');
  style.textContent = `@keyframes admissionFeedbackSuccess{0%{transform:scale(.985)}55%{transform:scale(1.015);box-shadow:0 0 0 5px rgba(22,163,74,.17)}100%{transform:scale(1)}}@keyframes admissionFeedbackError{0%,100%{transform:translateX(0)}30%{transform:translateX(-4px)}65%{transform:translateX(4px)}}.admission-feedback-success{animation:admissionFeedbackSuccess 220ms ease-out}.admission-feedback-error{animation:admissionFeedbackError 190ms ease-out}@media(prefers-reduced-motion:reduce){.admission-feedback-success,.admission-feedback-error{animation:none!important}}`;
  document.head.append(style);
})();
