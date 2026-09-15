(() => {
  'use strict';

  const STORAGE_KEY = 'admissionHub.experienceStudio.v2';
  const TYPES = ['themes', 'animations', 'cards'];
  const TYPE_ALIASES = { theme: 'themes', themes: 'themes', animation: 'animations', animations: 'animations', card: 'cards', cards: 'cards' };
  const state = load();
  const hooks = { themes: null, animations: null, cards: null };
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function baseState() {
    return {
      version: 2,
      unlocked: { themes: [], animations: [], cards: [] },
      active: { themes: null, animations: null, cards: null },
      updatedAt: 0
    };
  }

  function normalize(raw) {
    const next = baseState();
    if (!raw || typeof raw !== 'object') return next;
    TYPES.forEach((type) => {
      const legacyList = Array.isArray(raw.unlocked?.[type]) ? raw.unlocked[type] : raw.purchased?.[type];
      next.unlocked[type] = [...new Set((Array.isArray(legacyList) ? legacyList : []).map((id) => String(id)).filter(Boolean))];
      const active = raw.active?.[type];
      next.active[type] = active === null || active === undefined ? null : String(active);
    });
    next.updatedAt = Number(raw.updatedAt || 0);
    return next;
  }

  function load() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      const legacy = localStorage.getItem('admissionHub.experienceStudio.v1');
      return normalize(JSON.parse(current || legacy || 'null'));
    } catch (_) {
      return baseState();
    }
  }

  function save() {
    state.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('experience-studio-state-change', { detail: clone(state) }));
  }

  function typeKey(type) {
    const key = TYPE_ALIASES[String(type || '').toLowerCase()];
    return key || null;
  }

  function catalogFor(type) {
    const key = typeKey(type);
    if (key === 'themes') return Array.isArray(window.ExperienceStudioThemes) ? window.ExperienceStudioThemes : [];
    if (key === 'animations') return Array.isArray(window.ExperienceStudioAnimations) ? window.ExperienceStudioAnimations : [];
    if (key === 'cards') return Array.isArray(window.ExperienceStudioCards) ? window.ExperienceStudioCards : [];
    return [];
  }

  function findItem(type, id) {
    return catalogFor(type).find((item) => String(item.id) === String(id)) || null;
  }

  function studyLevel() {
    const settings = window.CACHE?.settings || {};
    return Math.max(1, Number(settings.xpLevel ?? settings.level ?? 1) || 1);
  }

  function requiredLevel(item) {
    const explicit = Number(item?.requiredLevel ?? item?.unlockLevel ?? item?.levelRequired);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.floor(explicit));
    const position = Math.max(1, Number(item?.number || 1) || 1);
    const key = typeKey(item?.kind);
    const step = key === 'animations' ? 10 : key === 'themes' ? 10 : 10;
    return 1 + Math.floor((position - 1) / step);
  }

  function levelUnlocked(item) {
    return Boolean(item && studyLevel() >= requiredLevel(item));
  }

  function listFor(type) {
    const key = typeKey(type);
    return key ? state.unlocked[key] : [];
  }

  function register(type, hook) {
    const key = typeKey(type);
    if (!key || !hook || typeof hook !== 'object') return;
    hooks[key] = hook;
  }

  function unlock(type, id) {
    const key = typeKey(type);
    const item = findItem(key, id);
    if (!key || !item) return { ok: false, reason: 'missing-item' };
    const level = studyLevel();
    const required = requiredLevel(item);
    if (level < required) return { ok: false, reason: 'level-locked', item, level, requiredLevel: required };
    if (!state.unlocked[key].includes(String(item.id))) {
      state.unlocked[key].push(String(item.id));
      save();
    }
    return { ok: true, item, level, requiredLevel: required };
  }

  function apply(type, id) {
    const key = typeKey(type);
    const item = findItem(key, id);
    if (!key || !item) return { ok: false, reason: 'missing-item' };
    const level = studyLevel();
    const required = requiredLevel(item);
    if (level < required) return { ok: false, reason: 'level-locked', item, level, requiredLevel: required };
    if (!state.unlocked[key].includes(String(item.id))) state.unlocked[key].push(String(item.id));
    state.active[key] = String(item.id);
    save();
    hooks[key]?.apply?.(item);
    return { ok: true, item, level, requiredLevel: required };
  }

  function remove(type) {
    const key = typeKey(type);
    if (!key) return { ok: false, reason: 'invalid-type' };
    const previous = state.active[key];
    state.active[key] = null;
    save();
    hooks[key]?.remove?.(previous);
    return { ok: true, previous };
  }

  function isUnlocked(type, id) {
    const item = findItem(type, id);
    return levelUnlocked(item);
  }

  function isActive(type, id) {
    const key = typeKey(type);
    return Boolean(key && state.active[key] === String(id) && isUnlocked(key, id));
  }

  window.ExperienceStudioStore = {
    key: STORAGE_KEY,
    types: TYPES.slice(),
    snapshot: () => clone(state),
    catalog: catalogFor,
    findItem,
    studyLevel,
    requiredLevel,
    levelUnlocked,
    unlocked: listFor,
    unlock,
    purchase: unlock,
    apply,
    remove,
    register,
    isUnlocked,
    isPurchased: isUnlocked,
    isActive,
    resetLocalState: () => { const fresh = baseState(); TYPES.forEach((type) => { state.unlocked[type] = fresh.unlocked[type]; state.active[type] = fresh.active[type]; }); save(); }
  };

  window.addEventListener('experience-studio-state-request', () => window.dispatchEvent(new CustomEvent('experience-studio-state-response', { detail: clone(state) })));
  window.addEventListener('study-level-change', () => window.dispatchEvent(new CustomEvent('experience-studio-level-change', { detail: { level: studyLevel() } })));
})();
