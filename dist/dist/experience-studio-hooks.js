(() => {
  'use strict';

  const last = { xp: null, gold: null, diamond: null, level: null, streak: null, progress: null };
  const dispatch = (name, detail = {}) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const num = (value) => Number(value || 0);
  const settingsSnapshot = () => window.CACHE?.settings || {};
  const gameSnapshot = () => window.CACHE?.game || {};

  const observeProgress = (target) => {
    const settings = settingsSnapshot();
    const game = gameSnapshot();
    const values = {
      xp: num(settings.xpBalance), gold: num(game.gold ?? settings.gold), diamond: num(game.diamonds ?? settings.diamonds),
      level: num(settings.xpLevel ?? settings.level), streak: num(settings.streak ?? settings.currentStreak), progress: num(settings.progressPercent ?? settings.progress)
    };
    if (last.xp !== null && values.xp > last.xp) dispatch('experience-xp-gain', { amount: values.xp - last.xp, target });
    if (last.gold !== null && values.gold > last.gold) dispatch('experience-gold-gain', { amount: values.gold - last.gold, target });
    if (last.diamond !== null && values.diamond > last.diamond) dispatch('experience-diamond-gain', { amount: values.diamond - last.diamond, target });
    if (last.level !== null && values.level > last.level) dispatch('experience-level-up', { level: values.level, target });
    if (last.streak !== null && values.streak !== last.streak) dispatch('experience-streak-update', { streak: values.streak, target });
    if (last.progress !== null && values.progress !== last.progress) dispatch('experience-progress-update', { progress: values.progress, target });
    Object.assign(last, values);
  };

  const wrap = (name, after) => {
    const fn = window[name];
    if (typeof fn !== 'function' || fn.__experienceStudioWrapped) return;
    const wrapped = function experienceStudioWrappedFunction(...args) {
      const before = { settings: { ...settingsSnapshot() }, game: { ...gameSnapshot() } };
      let result;
      try { result = fn.apply(this, args); } catch (error) { throw error; }
      Promise.resolve(result).then(() => { try { after({ args, before, result }); observeProgress(document.activeElement); } catch (_) {} });
      return result;
    };
    wrapped.__experienceStudioWrapped = true;
    wrapped.__experienceStudioOriginal = fn;
    window[name] = wrapped;
  };

  const install = () => {
    observeProgress(document.body);
    wrap('navigate', ({ args }) => dispatch('experience-action', { action: 'navigation', path: args[0] }));
    wrap('render', () => dispatch('experience-action', { action: 'navigation' }));
    wrap('dbPut', ({ args, before }) => {
      const storeName = String(args[0] || '');
      if (storeName === 'settings' || storeName === 'game') {
        dispatch('experience-persistence', { store: storeName, before, after: args[1] });
        observeProgress(document.activeElement);
      }
    });
    wrap('persistSettings', ({ args }) => { dispatch('experience-persistence', { store: 'settings', after: args[0] }); observeProgress(document.activeElement); });
  };

  const answerClick = (event) => {
    const node = event.target.closest?.('button,[role="button"],.btn');
    if (!node) return;
    const label = (node.textContent || '').trim().toLowerCase();
    if (/(submit|জমা|check answer|উত্তর দিন|finish|complete|পরীক্ষা শেষ)/i.test(label)) {
      dispatch('experience-answer-submit', { target: node });
      dispatch('experience-action', { action: 'submit', target: node });
    }
  };
  const answerStateObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') return;
      const node = mutation.target;
      if (!(node instanceof Element)) return;
      if (node.classList.contains('correct')) dispatch('experience-answer-correct', { target: node });
      if (node.classList.contains('wrong')) dispatch('experience-answer-wrong', { target: node });
    });
  });

  window.addEventListener('experience-studio-state-change', () => setTimeout(() => observeProgress(document.activeElement), 0));
  document.addEventListener('click', answerClick, true);
  answerStateObserver.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
  install();
  setInterval(install, 700);
  window.experienceStudioDispatchAction = (action, target, detail = {}) => dispatch('experience-action', { ...detail, action, target });
})();
