import { pathToFileURL } from 'node:url';

const PROVIDER_NAME = /^(?:RESEND|BREVO|MAILJET|MAILTRAP|MAILERSEND|SENDPULSE|EMAILOCTOPUS|COURIER|AGENTMAIL|DEADSIMPLEEMAIL)(?:_[A-Z0-9]+)*$/;
const LEGACY_PROVIDER_NAMES = new Set([
  'MAIL_FROM',
  'BREVO_FROM',
  'BREVO_KEY',
  'RESEND_KEY',
  'RESEND_KEY_2'
]);

const safeIdentifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const providerBindingName = value =>
  typeof value === 'string' &&
  /^[A-Z][A-Z0-9_]{0,127}$/.test(value) &&
  (PROVIDER_NAME.test(value) || LEGACY_PROVIDER_NAMES.has(value));

const namesOnly = values => [...new Set(values.filter(providerBindingName))].sort();

async function cloudflareJson({ accountId, apiToken, apiPath, fetchImpl }) {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${apiPath}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(15_000)
    }
  );
  if (!response.ok) throw new Error(`Cloudflare names-only inventory failed for ${apiPath.split('/').slice(1, 3).join('/')} (HTTP ${response.status}).`);
  const payload = await response.json();
  if (payload?.success !== true) throw new Error(`Cloudflare names-only inventory response was unsuccessful for ${apiPath.split('/').slice(1, 3).join('/')}.`);
  return payload.result;
}

function pageEnvironmentNames(project) {
  const configs = project?.deployment_configs && typeof project.deployment_configs === 'object'
    ? project.deployment_configs
    : {};
  return ['production', 'preview'].flatMap(environment => {
    const envVars = configs?.[environment]?.env_vars;
    const keys = envVars && typeof envVars === 'object' && !Array.isArray(envVars)
      ? Object.keys(envVars)
      : [];
    const names = namesOnly(keys);
    return names.length ? [{ environment, names }] : [];
  });
}

export async function auditCloudflareProviderLocations({
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!accountId || !apiToken) throw new Error('Required Cloudflare deployment credential is not available.');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const locations = [];
  const scripts = await cloudflareJson({ accountId, apiToken, apiPath: '/workers/scripts', fetchImpl });
  for (const script of Array.isArray(scripts) ? scripts : []) {
    const scriptName = script?.id;
    if (!safeIdentifier(scriptName)) continue;
    const records = await cloudflareJson({
      accountId,
      apiToken,
      apiPath: `/workers/scripts/${encodeURIComponent(scriptName)}/secrets`,
      fetchImpl
    });
    const names = namesOnly((Array.isArray(records) ? records : []).map(record => record?.name));
    if (names.length) locations.push({ type: 'worker', name: scriptName, environment: null, names });
  }

  const projects = await cloudflareJson({ accountId, apiToken, apiPath: '/pages/projects', fetchImpl });
  for (const record of Array.isArray(projects) ? projects : []) {
    const projectName = record?.name;
    if (!safeIdentifier(projectName)) continue;
    const project = await cloudflareJson({
      accountId,
      apiToken,
      apiPath: `/pages/projects/${encodeURIComponent(projectName)}`,
      fetchImpl
    });
    for (const found of pageEnvironmentNames(project)) {
      locations.push({ type: 'pages', name: projectName, environment: found.environment, names: found.names });
    }
  }

  return Object.freeze(locations.map(location => Object.freeze({
    ...location,
    names: Object.freeze([...location.names])
  })));
}

async function main({ env = process.env, stdout = process.stdout } = {}) {
  const locations = await auditCloudflareProviderLocations({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN
  });
  if (!locations.length) {
    stdout.write('::notice title=Cloudflare provider credential locations::No provider-related binding names found in Workers or Pages.\n');
    return;
  }
  for (const location of locations) {
    const suffix = location.environment ? `:${location.environment}` : '';
    stdout.write(`::notice title=Cloudflare provider binding names::${location.type}:${location.name}${suffix}: ${location.names.join(', ')}\n`);
  }
  stdout.write('::notice title=Cloudflare inventory boundary::Names and locations only; no value was printed, copied, changed or deleted.\n');
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  main().catch(error => {
    process.stderr.write(`::error title=Cloudflare provider-location audit failed::${error.message}\n`);
    process.exitCode = 1;
  });
}
