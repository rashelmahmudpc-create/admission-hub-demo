// Sets the AgentMail inbox display name so the OTP sender reads as the product
// brand instead of "AgentMail".
//
// AgentMail derives the sender identity from the inbox, and its send endpoint has
// no per-message from field, so the only lever is the inbox itself. This operation
// PATCHes that field and never prints the inbox address or the API key.
//
// Run:
//   AGENTMAIL_API_KEY=... AGENTMAIL_INBOX_ID=... AGENTMAIL_INBOX_DISPLAY_NAME=AdmissionSky \
//     node auth-native/operations/set-agentmail-display-name.mjs
//
// Exit code is 0 when the inbox reports the requested display name, 1 otherwise.

import { pathToFileURL } from 'node:url';

const AGENTMAIL_API = 'https://api.agentmail.to/v0';

const validSecret = value => typeof value === 'string' && value.trim().length >= 8;
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '')) && String(value).length <= 254;

// AgentMail echoes display_name on the inbox after a successful PATCH; a missing
// or mismatched value means the write did not take, so it is treated as failure.
export function displayNameApplied(payload, expected) {
  const actual = String(payload?.display_name ?? payload?.displayName ?? '').trim();
  return actual === String(expected || '').trim() && actual.length > 0;
}

export async function setAgentMailDisplayName({ apiKey, inboxId, displayName, fetchImpl = globalThis.fetch } = {}) {
  if (!validSecret(apiKey)) throw new Error('AGENTMAIL_API_KEY_MISSING');
  if (!validEmail(inboxId)) throw new Error('AGENTMAIL_INBOX_ID_INVALID');
  const name = String(displayName || '').trim();
  if (!name || name.length > 64) throw new Error('AGENTMAIL_DISPLAY_NAME_INVALID');

  const response = await fetchImpl(`${AGENTMAIL_API}/inboxes/${encodeURIComponent(inboxId)}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ display_name: name }),
    signal: AbortSignal.timeout(15_000)
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(`AGENTMAIL_UPDATE_FAILED_${response.status}`);
  if (!displayNameApplied(payload, name)) throw new Error('AGENTMAIL_DISPLAY_NAME_NOT_APPLIED');
  return Object.freeze({ applied: true });
}

async function main({ env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    await setAgentMailDisplayName({
      apiKey: env.AGENTMAIL_API_KEY,
      inboxId: env.AGENTMAIL_INBOX_ID,
      displayName: env.AGENTMAIL_INBOX_DISPLAY_NAME || 'AdmissionSky'
    });
    stdout.write('AGENTMAIL_DISPLAY_NAME status=PASS applied=true inboxPrinted=false keyPrinted=false\n');
  } catch (error) {
    const code = String(error?.message || 'AGENTMAIL_DISPLAY_NAME_FAILED').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    stderr.write(`::error title=AgentMail display name update failed::code=${code}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) main();
