/* D-V189: Seed removed — সব content এখন server (cloud) থেকে sync হয়।
   app-seed.js খালি — fallback seed নেই। শুধু cloud-content-sync.js দিয়ে data আসবে। */
window.AH_SEED = { subjects: [], topics: [], questions: [], vocabulary: [], vocabularyMaster: [] };

/* Welcome UI loader only. The empty content seed and all authentication code stay unchanged. */
(() => {
  if (document.getElementById('ah-welcome-ui-style')) return;
  const base = new URL('.', document.currentScript.src);
  const version = 'welcome-native-20261011-v33';
  const style = document.createElement('link');
  style.id = 'ah-welcome-ui-style'; style.rel = 'stylesheet';
  style.href = new URL(`welcome-onboarding.css?v=${version}`, base);
  style.onload = () => {
    const script = document.createElement('script');
    script.src = new URL(`welcome-onboarding.js?v=${version}`, base);
    script.defer = true; document.head.append(script);
  };
  document.head.append(style);
})();

/* Admission Sky signup surface loader. The engine (account-access.js) owns the
   real account flow; this only loads the owner's design CSS + controller, which
   call AdmissionAccount.SkyFlow. Kept separate from the welcome loader so a
   failure in one never blocks the other. */
(() => {
  if (document.getElementById('ah-sky-ui-style')) return;
  const base = new URL('.', document.currentScript.src);
  const version = 'welcome-native-20261011-v33';
  const style = document.createElement('link');
  style.id = 'ah-sky-ui-style'; style.rel = 'stylesheet';
  style.href = new URL(`sky.css?v=${version}`, base);
  style.onload = () => {
    const script = document.createElement('script');
    script.src = new URL(`sky.js?v=${version}`, base);
    script.defer = true; document.head.append(script);
  };
  document.head.append(style);
})();
