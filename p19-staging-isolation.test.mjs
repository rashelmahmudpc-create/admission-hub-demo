/* P19 — the staging isolation guard, and the config it guards.
 *
 * The guard exists because a staging config that points at a production resource
 * fails silently and destructively. These tests pin both directions: the shipped
 * config must pass the guard's own isolation rules, and the guard must actually
 * catch a production id, a production name, an unfilled placeholder and a cron
 * trigger when they are present.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkStagingConfig, findProductionIds, findProductionNames, findPlaceholders,
  hasCronTrigger, PRODUCTION_IDS,
} from './scripts/check-staging-isolation.mjs';

const CONFIG = readFileSync('wrangler.staging.toml', 'utf8');

test('p19s-১: the shipped staging config contains no production resource id', () => {
  assert.deepEqual(findProductionIds(CONFIG), [], 'staging must never reference a live KV/D1/R2 id');
});

test('p19s-২: the shipped staging config contains no production resource name', () => {
  assert.deepEqual(findProductionNames(CONFIG), [],
    'admission-gk-staging is fine; bare admission-gk / admission-hub / admission-profile are not');
});

test('p19s-৩: the shipped staging config carries no cron trigger', () => {
  assert.equal(hasCronTrigger(CONFIG), false,
    'a cron on staging would send real notifications to real students');
});

test('p19s-৪: the shipped config is refused until setup-staging.sh fills the placeholders', () => {
  const { ok, problems } = checkStagingConfig(CONFIG);
  assert.equal(ok, false, 'an unfilled placeholder must block the deploy');
  assert.ok(problems.some(p => p.includes('unfilled placeholder')),
    'the refusal must name the placeholder problem');
});

test('p19s-৫: the guard catches a production id', () => {
  const bad = CONFIG.replace('REPLACE_WITH_STAGING_GK_KV_ID', PRODUCTION_IDS[0]);
  assert.deepEqual(findProductionIds(bad), [PRODUCTION_IDS[0]]);
  assert.equal(checkStagingConfig(bad).ok, false);
});

test('p19s-৬: the guard catches a production name written as a whole value', () => {
  const bad = CONFIG.replace('bucket_name = "admission-hub-staging"', 'bucket_name = "admission-hub"');
  assert.deepEqual(findProductionNames(bad), ['admission-hub']);
  assert.equal(checkStagingConfig(bad).ok, false);
});

test('p19s-৭: the guard does not mistake a staging name for a production one', () => {
  assert.deepEqual(findProductionNames('bucket_name = "admission-hub-staging"'), []);
  assert.deepEqual(findProductionNames('database_name = "admission-profile-staging"'), []);
});

test('p19s-৮: the guard catches a cron trigger', () => {
  const bad = `${CONFIG}\n[triggers]\ncrons = ["* * * * *"]\n`;
  assert.equal(hasCronTrigger(bad), true);
  assert.ok(checkStagingConfig(bad).problems.some(p => p.includes('cron trigger')));
});

test('p19s-৯: a fully configured, isolated config passes', () => {
  const good = CONFIG
    .replace(/REPLACE_WITH_STAGING_[A-Z0-9_]+/g, 'staging-id-0000000000000000000000000000000')
    .replace(/REPLACE_WITH_STAGING_D1_ID/g, '00000000-0000-0000-0000-000000000000');
  const { ok, problems } = checkStagingConfig(good);
  assert.equal(ok, true, `expected a clean pass, got: ${problems.join('; ')}`);
});

test('p19s-১০: placeholders are reported once each, however often they appear', () => {
  const text = 'a REPLACE_X b REPLACE_X c REPLACE_Y';
  assert.deepEqual(findPlaceholders(text).sort(), ['REPLACE_X', 'REPLACE_Y']);
});
