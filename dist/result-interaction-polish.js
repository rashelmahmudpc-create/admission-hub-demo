/* Result-page interaction polish: focused topic navigation and compact review accordions. */
(() => {
  'use strict';
  const isInteractive = target => !!target.closest('button,a,input,select,textarea,label,.result-option,.result-action');
  const targetForTopic = topicId => {
    const selector = `.result-review-card[data-result-topic-id="${CSS.escape(String(topicId || ''))}"]`;
    return document.querySelector(selector);
  };
  const revealReview = card => {
    if (!card) return;
    card.classList.remove('result-review-collapsed');
    card.setAttribute('aria-expanded', 'true');
    card.scrollIntoView({ block:'start', behavior:'smooth' });
    card.classList.add('result-review-highlight');
    window.setTimeout(() => card.classList.remove('result-review-highlight'), 750);
  };
  const toggleReview = card => {
    const collapsed = card.classList.toggle('result-review-collapsed');
    card.setAttribute('aria-expanded', String(!collapsed));
  };
  document.addEventListener('click', event => {
    const topic = event.target.closest('.result-focus-item[data-result-topic-id]');
    if (topic) { revealReview(targetForTopic(topic.dataset.resultTopicId)); return; }
    const card = event.target.closest('.result-review-card');
    if (!card || isInteractive(event.target)) return;
    toggleReview(card);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const topic = event.target.closest('.result-focus-item[data-result-topic-id]');
    if (topic) { event.preventDefault(); revealReview(targetForTopic(topic.dataset.resultTopicId)); return; }
    const card = event.target.closest('.result-review-card');
    if (card) { event.preventDefault(); toggleReview(card); }
  });
  const style = document.createElement('style');
  style.textContent = `.result-focus-item{cursor:pointer;transition:transform .16s ease,border-color .16s ease}.result-focus-item:active{transform:scale(.985)}.result-review-card{cursor:pointer}.result-review-card.result-review-collapsed{padding-top:12px;padding-bottom:12px}.result-review-card.result-review-collapsed .result-question,.result-review-card.result-review-collapsed .result-options,.result-review-card.result-review-collapsed .result-explanation,.result-review-card.result-review-collapsed .result-actions{display:none}.result-review-highlight{animation:resultReviewGlow .72s ease}@keyframes resultReviewGlow{0%,100%{box-shadow:0 8px 24px rgba(15,107,79,.07)}50%{box-shadow:0 0 0 3px rgba(15,107,79,.20),0 13px 30px rgba(15,107,79,.16)}}`;
  document.head.appendChild(style);
})();
