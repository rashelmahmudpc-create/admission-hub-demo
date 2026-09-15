/* Direct, mobile-safe Vocabulary pronunciation. Runs synchronously on the tap gesture.
   v104 pipeline: custom uploaded voice → ElevenLabs (IndexedDB cache → worker generate) → Web Speech TTS. */
(() => {
  'use strict';
  const supported = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const englishVoices = () => (window.speechSynthesis?.getVoices?.() || []).filter(voice => /^en(-|_)/i.test(voice.lang || ''));
  const pickVoice = () => {
    const voices = englishVoices();
    const natural = /samantha|ava|karen|daniel|moira|allison|serena|aria|jenny|zira|sonia|google uk english female|google us english|microsoft.*online|natural|enhanced/i;
    const ranked = voices.map(voice => {
      const name = String(voice.name || '');
      const lang = String(voice.lang || '').toLowerCase();
      let score = 0;
      if (natural.test(name)) score += 50;
      if (lang === 'en-us') score += 20;
      if (lang === 'en-gb') score += 12;
      if (voice.localService) score += 5;
      if (/compact|espeak|festival|robot/i.test(name)) score -= 30;
      return { voice, score };
    }).sort((a, b) => b.score - a.score);
    return ranked[0]?.voice || voices[0] || null;
  };
  const voiceKey = word => String(word || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let customAudio = null;
  const playCustom = key => {
    const lib = window.__vmVoiceLib;
    if (!lib || !lib[key]) return false;
    const shared = window.VocabularyElevenLabs;
    if (shared?.playUrl) { try { if (shared.playUrl(lib[key])) return true; } catch (_) {} }
    try {
      customAudio = customAudio || new Audio();
      customAudio.pause();
      customAudio.src = lib[key];
      customAudio.currentTime = 0;
      const p = customAudio.play();
      if (p && p.catch) p.catch(() => {});
      return true;
    } catch (_) { return false; }
  };
  const speakTts = rawWord => {
    const word = String(rawWord || '').replace(/[^A-Za-z' -]/g, '');
    if (!word) return;
    if (!supported()) { window.toast?.('এই device-এ pronunciation available নয়'); return; }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = 'en-US';
      utterance.rate = .88;
      utterance.pitch = 1.02;
      utterance.volume = 1;
      const voice = pickVoice();
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang || utterance.lang; }
      window.speechSynthesis.speak(utterance);
    } catch (_) {
      window.toast?.('Pronunciation শুরু করা যায়নি');
    }
  };
  const speak = (raw, btn) => {
    const rawWord = String(raw || '').trim();
    if (!rawWord) return;
    if (playCustom(voiceKey(rawWord))) return;
    const eleven = window.VocabularyElevenLabs;
    if (eleven?.speakWord) { try { eleven.speakWord(rawWord, btn); return; } catch (_) {} }
    speakTts(rawWord);
  };
  if (supported()) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices());
  }
  const loadVoiceLib = () => {
    try {
      if (typeof dbGetAll !== 'function') return;
      dbGetAll('vocabularyMaster').then(rows => {
        const lib = {};
        (rows || []).forEach(row => { if (row && row.tool === 'vocabulary-master-voice' && row.normalized && row.dataUrl) lib[row.normalized] = row.dataUrl; });
        window.__vmVoiceLib = lib;
      }).catch(() => {});
    } catch (_) {}
  };
  loadVoiceLib();
  window.VocabularyPronunciation = {
    play: speak,
    stop: () => { try { window.speechSynthesis?.cancel?.(); } catch (_) {} try { window.VocabularyElevenLabs?.stopAudio?.(); } catch (_) {} },
    voiceKey,
    reloadVoices: loadVoiceLib,
    speakTtsOnly: speakTts
  };
})();
