/* P13 — Performance core. Runs the SHIPPED module, not a copy. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./p13-performance-core.js', import.meta.url), 'utf8');
const P = new Function('self', `${src}\nreturn self.AhPerf;`)({});

test('p13-01: computeWindow renders only the visible slice', () => {
  const w = P.computeWindow({ itemCount: 1000, rowHeight: 50, viewportHeight: 500, scrollTop: 0, overscan: 0 });
  assert.equal(w.start, 0);
  assert.equal(w.count, 11);         // ceil(500/50) + 1
  assert.equal(w.offsetY, 0);
  assert.equal(w.totalHeight, 50000);
});

test('p13-02: computeWindow follows the scroll position', () => {
  const w = P.computeWindow({ itemCount: 1000, rowHeight: 50, viewportHeight: 500, scrollTop: 5000, overscan: 0 });
  assert.equal(w.start, 100);
  assert.equal(w.offsetY, 5000);
});

test('p13-03: overscan extends the slice on both sides but never past the ends', () => {
  const mid = P.computeWindow({ itemCount: 1000, rowHeight: 50, viewportHeight: 500, scrollTop: 5000, overscan: 3 });
  assert.equal(mid.start, 97);
  const top = P.computeWindow({ itemCount: 1000, rowHeight: 50, viewportHeight: 500, scrollTop: 0, overscan: 3 });
  assert.equal(top.start, 0);
  const bottom = P.computeWindow({ itemCount: 100, rowHeight: 50, viewportHeight: 500, scrollTop: 4800, overscan: 10 });
  assert.equal(bottom.end, 100);
});

test('p13-04: a tiny list still renders everything', () => {
  const w = P.computeWindow({ itemCount: 3, rowHeight: 50, viewportHeight: 500, scrollTop: 0 });
  assert.equal(w.start, 0);
  assert.equal(w.end, 3);
  assert.equal(w.count, 3);
});

test('p13-05: swr renders cache instantly and skips the network when fresh', () => {
  const r = P.swr({ value: ['a'], at: 1000 }, { now: 2000, maxAge: 60000 });
  assert.deepEqual(r.render, ['a']);
  assert.equal(r.fetch, false);
  assert.equal(r.fresh, true);
});

test('p13-06: swr refreshes in the background when the cache is stale', () => {
  const r = P.swr({ value: ['old'], at: 1000 }, { now: 200000, maxAge: 60000 });
  assert.deepEqual(r.render, ['old']);
  assert.equal(r.fetch, true);
  assert.equal(r.fresh, false);
});

test('p13-07: swr with no cache asks for a fetch and can fall back', () => {
  const r = P.swr(null, { now: 1000, fallback: [] });
  assert.deepEqual(r.render, []);
  assert.equal(r.fetch, true);
  assert.equal(r.cached, false);
});

test('p13-08: the prefetcher dedupes and warms each url once', async () => {
  const seen = [];
  const pf = P.createPrefetcher({ runner: async url => { seen.push(url); } });
  assert.equal(pf.addMany(['./a.js', './b.js']), 2);
  assert.equal(pf.addMany(['./a.js']), 0);         // already queued
  await pf.drain();
  await pf.drain();
  assert.deepEqual(seen, ['./a.js', './b.js']);
  assert.equal(pf.warmedCount(), 2);
  assert.ok(pf.has('./a.js'));
});

test('p13-09: a failing warm does not stop the queue', async () => {
  const ok = [];
  const pf = P.createPrefetcher({ runner: async url => { if (url === './bad.js') throw new Error('x'); ok.push(url); } });
  pf.addMany(['./bad.js', './good.js']);
  await pf.drain();
  assert.deepEqual(ok, ['./good.js']);
});

test('p13-10: addMany respects the queue limit', () => {
  const pf = P.createPrefetcher({ runner: async () => {}, limit: 2 });
  assert.equal(pf.addMany(['a', 'b', 'c', 'd']), 2);
  assert.equal(pf.size(), 2);
});

test('p13-11: canPrefetch backs off on save-data and 2G', () => {
  assert.equal(P.canPrefetch({ connection: { saveData: true } }), false);
  assert.equal(P.canPrefetch({ connection: { effectiveType: '2g' } }), false);
  assert.equal(P.canPrefetch({ connection: { effectiveType: '4g' } }), true);
  assert.equal(P.canPrefetch({}), true);
});

test('p13-12: mark/measure returns a non-negative duration', () => {
  const t = P.mark('p13-test');
  const ms = P.measure('p13-dur', 'p13-test');
  assert.equal(typeof t, 'number');
  assert.ok(ms >= 0);
});
