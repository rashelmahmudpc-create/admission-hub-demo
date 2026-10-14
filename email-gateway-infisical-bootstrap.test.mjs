import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  bootstrapInfisicalSafeSource,
  INFISICAL_SAFE_BOOTSTRAP_NAMES
} from './email-gateway/operations/bootstrap-infisical-source.mjs';

const env = () => ({
  INFISICAL_DOMAIN: 'https://app.infisical.com',
  INFISICAL_ENV_SLUG: 'prod',
  INFISICAL_SECRET_PATH: '/email-gateway',
  INFISICAL_IDENTITY_ID: '00000000-0000-4000-8000-000000000001',
  INFISICAL_PROJECT_SLUG: 'admission-hub-test',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fake-github-request-token-for-tests',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.actions.githubusercontent.com/oidc/token'
});

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' }
});

function successfulFetch({ existing = [] } = {}) {
  const calls = [];
  let created = [];
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.startsWith('https://pipelines.actions.githubusercontent.com/')) return json({ value: 'x'.repeat(180) });
    if (url.endsWith('/api/v1/auth/oidc-auth/login')) return json({ accessToken: 'a'.repeat(64) });
    if (url.includes('/api/v1/projects/slug/')) {
      return json({
        id: '00000000-0000-4000-8000-000000000002',
        slug: 'admission-hub-test',
        environments: [{ name: 'Production', slug: 'prod' }]
      });
    }
    if (url.includes('/api/v3/secrets/raw')) {
      const names = created.length ? created : existing;
      return json({ secrets: names.map(secretKey => ({ secretKey })) });
    }
    if (url.endsWith('/api/v4/secrets/batch')) {
      const body = JSON.parse(options.body);
      created = body.secrets.map(item => item.secretKey);
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected mock URL: ${url}`);
  };
  return { fetchImpl, calls, getCreated: () => created };
}

test('safe bootstrap creates only credential-independent disabled controls and generated runtime values', async () => {
  const mock = successfulFetch();
  let output = '';
  const result = await bootstrapInfisicalSafeSource({
    env: env(),
    fetchImpl: mock.fetchImpl,
    randomBytes: size => Buffer.alloc(size, 7),
    stdout: { write: value => { output += value; } }
  });

  assert.equal(result.names, 18);
  assert.equal(result.activation, 'disabled');
  assert.equal(result.credentials, 'none');
  assert.deepEqual(mock.getCreated().sort(), [...INFISICAL_SAFE_BOOTSTRAP_NAMES].sort());
  const batch = mock.calls.find(call => call.url.endsWith('/api/v4/secrets/batch'));
  const body = JSON.parse(batch.options.body);
  assert.equal(body.environment, 'prod');
  assert.equal(body.secretPath, '/email-gateway');
  const values = Object.fromEntries(body.secrets.map(item => [item.secretKey, item.secretValue]));
  assert.equal(values.EMAIL_PROVIDER_ACTIVATION, 'disabled');
  assert.ok(values.EMAIL_GATEWAY_SIGNING_SECRET.length >= 32);
  assert.ok(values.EMAIL_RECIPIENT_HASH_PEPPER.length >= 32);
  assert.equal(Object.keys(values).some(name => name.endsWith('_API_KEY') || name.endsWith('_SECRET_KEY')), false);
  for (const prefix of ['RESEND', 'BREVO', 'MAILJET', 'MAILTRAP', 'MAILERSEND', 'SENDPULSE', 'COURIER']) {
    assert.equal(values[`${prefix}_FROM_NAME`], 'AdmissionSky');
    assert.equal(values[`${prefix}_SENDER_VERIFIED`], 'false');
  }
  const config = JSON.parse(values.EMAIL_GATEWAY_CONFIG);
  assert.equal(config.environment, 'production');
  assert.ok(Object.values(config.providerPolicies).every(policy => policy.enabled === false));
  assert.match(output, /^INFISICAL_SAFE_BOOTSTRAP_COMPLETED names=18 credentials=none activation=disabled senderVerified=false\n$/);
  assert.ok(!output.includes(values.EMAIL_GATEWAY_SIGNING_SECRET));
  assert.ok(!output.includes(values.EMAIL_RECIPIENT_HASH_PEPPER));
  assert.ok(mock.calls.every(call => !call.url.includes('api.brevo.com')));
});

test('safe bootstrap refuses every overwrite before a batch write', async () => {
  const mock = successfulFetch({ existing: ['EMAIL_PROVIDER_ACTIVATION'] });
  await assert.rejects(
    bootstrapInfisicalSafeSource({ env: env(), fetchImpl: mock.fetchImpl, stdout: { write() {} } }),
    /INFISICAL_BOOTSTRAP_REFUSES_OVERWRITE_EMAIL_PROVIDER_ACTIVATION/
  );
  assert.equal(mock.calls.some(call => call.url.endsWith('/api/v4/secrets/batch')), false);
});

test('safe bootstrap workflow is manual, OIDC-only, credential-independent, pinned and has no Cloudflare step', async () => {
  const workflow = await readFile('.github/workflows/email-gateway-infisical-bootstrap.yml', 'utf8');
  assert.match(workflow, /BOOTSTRAP_INFISICAL_SAFE_SOURCE/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: email-gateway-production/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /secrets\.|BREVO_KEY|wrangler|CLOUDFLARE|secret bulk/i);
});
