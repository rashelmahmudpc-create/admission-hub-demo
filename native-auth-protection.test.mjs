import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const read = file => readFileSync(resolve(root, file), 'utf8');
const cspHash = value => `sha256-${createHash('sha256').update(value).digest('base64')}`;
const walk = directory => readdirSync(resolve(root, directory)).flatMap(name => {
  const full = resolve(root, directory, name);
  return statSync(full).isDirectory() ? walk(relative(root, full)) : [relative(root, full).split(sep).join('/')];
});
const runtime = walk('auth-native').filter(file => file.endsWith('.mjs') && !file.includes('/testing/') && !file.includes('/operations/')).map(read).join('\n');
const handler = read('auth-native/worker/public-auth-handler.mjs');
const provider = read('auth-native/providers/firebase-auth.mjs');
const client = ['account-access.js', 'account-access.css'].filter(file => existsSync(resolve(root, file))).map(read).join('\n');
const worker = read('gk-agent-worker.js');
const bundle = read('worker-bundle.mjs');
const wrangler = read('wrangler.toml');
const pagesWorker = read('_worker.js');
const pagesWorkflow = read('.github/workflows/cf-pages.yml');
const activationWorkflow = read('.github/workflows/native-auth-activate.yml');
const boundaryWorkflow = read('.github/workflows/firebase-auth-boundary-deploy.yml');
const googleReadinessWorkflow = read('.github/workflows/google-auth-readiness-audit.yml');
const googleReadinessOperation = read('auth-native/operations/verify-google-readiness.mjs');
const googleBrowserOriginOperation = read('auth-native/operations/verify-google-browser-origin.mjs');
const telegramCanaryWorkflow = read('.github/workflows/telegram-auth-canary-activate.yml');
const telegramBindingOperation = read('auth-native/operations/verify-telegram-bindings.mjs');
const telegramSecurity = read('auth-native/verification/telegram-security.mjs');
const liveMailboxOperation = read('auth-native/operations/live-mailbox-e2e.mjs');
const serviceWorker = read('sw.js');
const verificationProviders = read('auth-native/verification/providers.mjs');
const verificationOrchestrator = read('auth-native/verification/orchestrator.mjs');
const verificationControlCenter = read('verification-control-center.html');
const headersPolicy = read('_headers');

const forbiddenLegacyRoutes = [
  '/api/auth/login', '/api/auth/register', '/api/auth/register-email', '/api/auth/google',
  '/api/auth/otp/send', '/api/auth/password', '/api/auth/delete', '/api/profile',
  '/api/onboarding', '/api/state', '/api/re-auth', '/api/sessions/revoke'
];

test('Firebase Auth authority, storage, provider, API, and client boundaries exist', () => {
  const required = [
    'auth-native/core/auth-engine.mjs', 'auth-native/core/crypto.mjs', 'auth-native/core/errors.mjs',
    'auth-native/core/secret-vault.mjs', 'auth-native/core/webauthn.mjs',
    'auth-native/providers/firebase-auth.mjs', 'auth-native/storage/sqlite-auth-repository.mjs',
    'auth-native/verification/provider-contract.mjs', 'auth-native/verification/config.mjs',
    'auth-native/verification/orchestrator.mjs', 'auth-native/verification/providers.mjs',
    'auth-native/verification/sqlite-verification-repository.mjs', 'auth-native/verification/telegram-security.mjs',
    'auth-native/operations/verify-telegram-bindings.mjs',
    'auth-native/worker/auth-authority-do.mjs', 'auth-native/worker/public-auth-handler.mjs',
    '.github/workflows/telegram-auth-canary-activate.yml',
    'verification-control-center.html', 'native-auth.test.mjs', 'native-auth-protection.test.mjs'
  ];
  assert.deepEqual(required.filter(file => !existsSync(resolve(root, file))), []);
});

test('runtime uses Web Crypto and has no weak random, plaintext credential store, client bearer session, or logging primitive', () => {
  assert.doesNotMatch(runtime, /Math\.random|bcrypt|password_hash|issueToken|jsonwebtoken/i);
  assert.match(runtime, /getRandomValues/);
  assert.match(runtime, /subtle\.sign\('HMAC'/);
  assert.doesNotMatch(runtime, /localStorage|sessionStorage|document\.cookie|indexedDB/i);
  assert.doesNotMatch(handler, /request\.headers\.get\(['"]Authorization['"]\)|Authorization\s*:\s*['"`]Bearer/i);
  assert.doesNotMatch(runtime, /console\.(log|info|warn|error|debug)\s*\(/);
});

test('SQLite authority stores HMAC references and never plaintext email, password, or session token', () => {
  const storage = read('auth-native/storage/sqlite-auth-repository.mjs');
  assert.match(storage, /email_ref TEXT NOT NULL UNIQUE/);
  assert.match(storage, /subject_ref TEXT NOT NULL/);
  assert.match(storage, /session_ref TEXT PRIMARY KEY/);
  assert.doesNotMatch(storage, /\bemail TEXT|password(?:_hash)? TEXT|plain(?:text)?_password|session_token/i);
  assert.match(storage, /transactionSync/);
  assert.match(storage, /auth_external_identities/);
  const verificationStorage = read('auth-native/verification/sqlite-verification-repository.mjs');
  assert.match(verificationStorage, /code_mac TEXT NOT NULL/);
  assert.match(verificationStorage, /code_cipher TEXT NOT NULL DEFAULT ''/);
  assert.match(verificationStorage, /external_identity_ref TEXT NOT NULL UNIQUE/);
  assert.doesNotMatch(verificationStorage, /telegram_(?:user|chat)_id|plaintext_otp|\botp TEXT/i);
});

test('public API keeps Email/Password while adding Firebase-canonical Google and server-verified Passkeys', () => {
  assert.match(handler, /\/api\/auth\/v1/);
  assert.match(handler, /\$\{AUTH_API_PREFIX\}\/signup/);
  assert.match(handler, /\$\{AUTH_API_PREFIX\}\/login/);
  assert.match(handler, /\$\{AUTH_API_PREFIX\}\/verification\/resend/);
  assert.match(handler, /\$\{AUTH_API_PREFIX\}\/google/);
  assert.match(handler, /\$\{AUTH_API_PREFIX\}\/passkey\/authentication\/finish/);
  assert.match(handler, /if \(!user\.emailVerified\)/);
  assert.match(provider, /accounts:signUp/);
  assert.match(provider, /accounts:signInWithPassword/);
  assert.match(provider, /accounts:signInWithIdp/);
  assert.match(provider, /requestType: 'VERIFY_EMAIL'/);
  assert.match(provider, /accounts:lookup/);
  assert.doesNotMatch(handler, /\/otp\/request|\/otp\/verify|sendEmail|SIGNUP_VERIFICATION/);
});

test('generic backup verification is centralized and bound to the current Firebase UID and session', () => {
  assert.match(handler, /\$\{AUTH_API_PREFIX\}\/backup\/request/);
  assert.match(handler, /\$\{AUTH_API_PREFIX\}\/backup\/verify/);
  assert.match(handler, /backup\/request[\s\S]*firebaseReadySession[\s\S]*\/internal\/verification\/request/);
  assert.match(handler, /backup\/verify[\s\S]*firebaseReadySession[\s\S]*\/internal\/verification\/verify/);
  assert.match(verificationOrchestrator, /sessionRef[\s\S]*subjectRef[\s\S]*userId/);
  assert.match(verificationOrchestrator, /providerNamesExposed:\s*false/);
  assert.doesNotMatch(handler, /body\.(?:provider|providerId)|input\.(?:provider|providerId)/);
  assert.doesNotMatch(client, /otp-a|otp-b|otp-c|mailjet|brevo|sendgrid/i);
});

test('Google and the explicit Email-or-Telegram selector are public while Passkey and generic backup stay unpublished', () => {
  assert.match(wrangler, /GOOGLE_AUTH_ACTIVATION = "enabled"/);
  assert.match(wrangler, /PASSKEY_AUTH_ACTIVATION = "canary"/);
  assert.match(wrangler, /VERIFICATION_AUTH_ACTIVATION = "enabled"/);
  assert.match(wrangler, /VERIFICATION_ORCHESTRATOR_CONFIG = '\{"enabled":true,"providers":\[\{"id":"otp-a","enabled":true/);
  assert.doesNotMatch(wrangler, /"id":"(?:otp-b|otp-c|whatsapp)","enabled":true/);
  assert.match(handler, /googlePublished\(env\)/);
  assert.match(handler, /googleCanaryRequested\(env, url\)/);
  assert.match(handler, /passkeyPublished\(env\)/);
  assert.match(handler, /passkeyCanaryRequested\(env, url\)/);
  assert.match(handler, /AUTH_UI_VERSION\s*=\s*'auth-premium-v6'/);
  assert.match(handler, /CLIENT_UPDATE_REQUIRED/);
  assert.match(client, /'X-AH-Auth-UI':\s*'auth-premium-v6'/);
  assert.match(handler, /enrollmentAvailable:\s*passkeyEnrollmentAvailable/);
  assert.match(handler, /telegramCanaryRequested\(env, url\)/);
  assert.match(handler, /verificationPublished\(env\)/);
  assert.match(handler, /cacheVariant = `\$\{googleCanary \? 'google-canary' : 'public'\}:\$\{passkeyCanary \? 'passkey-canary' : 'public'\}:\$\{telegramCanary \? 'telegram-canary' : 'public'\}`/);
  assert.match(runtime, /\['canary', 'enabled'\]\.includes\(String\(env\.VERIFICATION_AUTH_ACTIVATION/);
  assert.match(activationWorkflow, /g\?\.available!==true/);
  assert.match(activationWorkflow, /verify-google-browser-origin\.mjs/);
  assert.match(activationWorkflow, /methods\?\.passkey\?\.available!==false/);
  assert.match(activationWorkflow, /methods\?\.backup\?\.available!==false/);
  assert.match(googleBrowserOriginOperation, /waitForSelector\('\.ah-account-page', \{ state: 'attached'/);
  assert.doesNotMatch(googleBrowserOriginOperation, /waitForSelector\('\.ah-account-launcher'/);
  assert.match(googleBrowserOriginOperation, /firstEntryWelcome/);
  assert.match(googleBrowserOriginOperation, /waitForFunction\(\(\) => typeof window\.AdmissionAccount\?\.open === 'function'/);
  assert.doesNotMatch(googleBrowserOriginOperation, /ah-account-launcher/);
  assert.match(googleBrowserOriginOperation, /welcome-google-button/);
  assert.match(googleBrowserOriginOperation, /iframe:visible/);
  assert.match(googleBrowserOriginOperation, /frameLocator\(googleFrameSelector\).*locator\('\[role="button"\]'\)/s);
  assert.match(googleBrowserOriginOperation, /context\.waitForEvent\('page'/);
  assert.doesNotMatch(googleBrowserOriginOperation, /googleFrame\.click\(/);
  assert.match(googleBrowserOriginOperation, /origin_mismatch/);
  assert.match(googleBrowserOriginOperation, /credentialUsed:\s*false/);
  assert.doesNotMatch(googleBrowserOriginOperation, /console\.(?:log|error)|popup\.url\(\)\s*\)/);
  assert.match(liveMailboxOperation, /google\?\.available === true/);
  assert.match(liveMailboxOperation, /google\?\.availabilityCode === 'READY'/);
  assert.match(liveMailboxOperation, /methods\?\.backup\?\.available === false/);
  assert.doesNotMatch(liveMailboxOperation, /methods\?\.google\?\.available !== false/);
});

test('Telegram public publication is protected, value-blind, reversible, and keeps generic backup isolated', () => {
  assert.match(telegramCanaryWorkflow, /inputs\.confirmation == 'PUBLISH_TELEGRAM_OTP'/);
  assert.match(telegramCanaryWorkflow, /verify-telegram-bindings\.mjs/);
  assert.match(telegramCanaryWorkflow, /TELEGRAM_CANARY_ACTIVATION_SECRET/);
  assert.match(telegramCanaryWorkflow, /secret delete TELEGRAM_CANARY_ACTIVATION_SECRET/);
  assert.match(telegramCanaryWorkflow, /telegram\/canary\/activate/);
  assert.match(telegramCanaryWorkflow, /telegram\/canary\/deactivate/);
  assert.match(telegramCanaryWorkflow, /backup\?\.availabilityCode!=='LIVE_E2E_PENDING'/);
  assert.match(telegramCanaryWorkflow, /telegramVerification/);
  assert.match(telegramCanaryWorkflow, /codeLength!==6/);
  assert.match(telegramCanaryWorkflow, /maxAttempts!==5/);
  assert.match(telegramCanaryWorkflow, /verifiesEmailOwnership!==false/);
  assert.match(telegramCanaryWorkflow, /canonicalIdentity!=='firebase-uid'/);
  assert.match(telegramCanaryWorkflow, /config\?telegramCanary=1/);
  assert.match(telegramCanaryWorkflow, /verify-google-browser-origin\.mjs/);
  assert.match(telegramCanaryWorkflow, /rollback "\$PREVIOUS_WORKER_VERSION"/);
  assert.doesNotMatch(telegramCanaryWorkflow, /TELEGRAM_(?:AUTH_)?BOT_TOKEN:\s*\$\{\{|TG_BOT_TOKEN:\s*\$\{\{/);
  assert.match(telegramBindingOperation, /valuesRead:\s*false/);
  assert.match(telegramBindingOperation, /namesPrinted=false/);
  assert.doesNotMatch(telegramBindingOperation, /process\.env\.(?:TG_BOT_TOKEN|AUTH_HMAC_SECRET|FIREBASE_WEB_API_KEY)/);
  assert.match(telegramSecurity, /subtle\.sign\('HMAC'/);
  assert.doesNotMatch(telegramSecurity, /console\.|TELEGRAM_AUTH_BOT_TOKEN|TG_BOT_TOKEN/);
  assert.match(handler, /url\.hostname !== 'admission-gk\.admissionhub\.workers\.dev'/);
  assert.match(handler, /telegramActivationAuthorized\(request, env\)/);
  assert.match(handler, /resolveTelegramWebhookSecret\(env\)/);
});

test('backup adapters keep credentials server-side and WhatsApp uses only the official API', () => {
  assert.match(verificationProviders, /https:\/\/graph\.facebook\.com/);
  assert.doesNotMatch(verificationProviders, /web\.whatsapp\.com|wa\.me|puppeteer|selenium/i);
  assert.doesNotMatch(client, /X-Verification-Key|TELEGRAM_AUTH_BOT_TOKEN|WHATSAPP_(?:AUTH_)?ACCESS_TOKEN|OTP_[ABC]_(?:API|PROVIDER)_KEY/);
  assert.doesNotMatch(verificationControlCenter, /localStorage\s*(?:\.|\[)|sessionStorage\s*(?:\.|\[)|document\.cookie\s*=|OTP_[ABC]_(?:API|PROVIDER)_KEY|WHATSAPP_(?:AUTH_)?ACCESS_TOKEN|TELEGRAM_AUTH_BOT_TOKEN/);
  const passwordFields = verificationControlCenter.match(/type="password"/g) || [];
  assert.equal(passwordFields.length, 1);
  assert.match(verificationControlCenter, /id="admin-key"[^>]*autocomplete="off"/);
});

test('Telegram OTP requires secret private-chat START, local code verification, and one canonical Firebase identity', () => {
  assert.match(handler, /X-Telegram-Bot-Api-Secret-Token/);
  assert.match(handler, /validTelegramWebhookSecret\(expected\)/);
  assert.match(handler, /message\?\.chat\?\.type !== 'private'/);
  assert.match(handler, /telegramUserId !== chatId/);
  assert.match(handler, /account-verification\/complete/);
  assert.match(verificationOrchestrator, /linkTokenMac/);
  assert.match(verificationOrchestrator, /telegram-identity-v1/);
  assert.match(verificationOrchestrator, /telegram-otp-v1/);
  assert.match(verificationOrchestrator, /sendTelegramCode/);
  assert.match(verificationOrchestrator, /phoneOwnership:\s*false/);
  assert.match(verificationProviders, /protect_content:\s*true/);
  assert.match(verificationProviders, /আপনার verification code/);
  assert.match(client, /id="ah-telegram-code"/);
  assert.match(client, /খোলা সফল যাচাই নয়/);
  assert.match(client, /Email মালিকানা নয়/);
  assert.doesNotMatch(client, /telegram-webhook-confirmed|server-confirmed/);
});

test('verification admin page is no-store, no-index, and never receives provider credentials', () => {
  assert.match(headersPolicy, /\/verification-control-center\.html[\s\S]*Cache-Control: no-store/);
  assert.match(headersPolicy, /\/verification-control-center\.html[\s\S]*X-Robots-Tag: noindex/);
  assert.match(headersPolicy, /\/verification-control-center\.html[\s\S]*Referrer-Policy: no-referrer/);
  assert.match(headersPolicy, /\/verification-control-center\n[\s\S]*X-Frame-Options: DENY/);
  assert.match(headersPolicy, /\/verification-control-center\.html[\s\S]*X-Frame-Options: DENY/);
  assert.match(headersPolicy, /\/verification-control-center\.html[\s\S]*frame-ancestors 'none'/);
  assert.doesNotMatch(headersPolicy, /\/verification-control-center\.html[\s\S]*unsafe-inline/);
  const inlineStyle = verificationControlCenter.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
  const inlineScript = verificationControlCenter.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
  assert.equal(headersPolicy.split(`style-src '${cspHash(inlineStyle)}'`).length - 1, 2);
  assert.equal(headersPolicy.split(`script-src '${cspHash(inlineScript)}'`).length - 1, 2);
  assert.match(handler, /adminAuthorized\(request, env\)/);
  assert.match(verificationControlCenter, /textContent/);
  assert.doesNotMatch(verificationControlCenter, /\.innerHTML\s*=/);
});

test('verification architecture exposes the Spark capacity, resend cooldown, and no registered-user cap', () => {
  assert.match(handler, /dailyCapacity: 1000/);
  assert.match(handler, /registeredAccountLimit: 'unlimited'/);
  assert.match(runtime, /firebase-verification-global-day[\s\S]*limit: 1000/);
  assert.match(runtime, /FIREBASE_VERIFICATION_RESEND_COOLDOWN_MS = 60 \* 1000/);
  assert.match(client, /startResendCooldown/);
  assert.match(client, /data-role="resend-status"/);
  assert.doesNotMatch(handler, /dailyCapacity:\s*5\b|daily:\s*5\b/);
});

test('email-link sign-in is not implemented', () => {
  assert.doesNotMatch(provider, /accounts:signInWithEmailLink|EMAIL_SIGNIN|sendSignInLinkToEmail|isSignInWithEmailLink/);
  assert.doesNotMatch(client, /signInWithEmailLink|sendSignInLinkToEmail|isSignInWithEmailLink/);
});

test('credentials remain in server-managed HttpOnly cookies and are never returned to client code', () => {
  assert.match(handler, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(handler, /AUTH_FIREBASE_COOKIE/);
  assert.match(handler, /AUTH_SESSION_COOKIE/);
  assert.doesNotMatch(handler, /sessionToken:\s*established\.sessionToken|refreshToken:\s*signed\.refreshToken/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|Authorization\s*:\s*['"`]Bearer/i);
  assert.match(client, /ENTRY_COOKIE = 'ah_entry_v1'/);
  assert.match(client, /PENDING_SIGNUP_COOKIE = 'ah_signup_pending_v1'/);
  assert.equal((client.match(/document\.cookie\s*=/g) || []).length, 2);
  assert.doesNotMatch(client, /document\.cookie\s*=.*(?:password|email|session|token|secret)/i);
  assert.match(client, /credentials:\s*'same-origin'/);
  assert.doesNotMatch(client, /firebase(?:Refresh|Id)?Token/i);
});

test('legacy standalone account implementation remains absent while secure multi-method routes stay guarded', () => {
  for (const route of forbiddenLegacyRoutes) {
    assert.equal(worker.includes(route), false, route);
    assert.equal(bundle.includes(route), false, route);
  }
  assert.doesNotMatch(worker, /premium-auth|hashPassword|verifyPassword/);
  assert.doesNotMatch(runtime, /prepareOtp\s*\(|verifyOtp\s*\(|\/internal\/otp\/|CREATE TABLE IF NOT EXISTS auth_challenges/);
  assert.match(runtime, /DROP TABLE IF EXISTS auth_challenges/);
  assert.match(worker, /createNativeAuthHandler/);
  assert.match(handler, /GOOGLE_AUTH_ACTIVATION/);
  assert.match(handler, /PASSKEY_AUTH_ACTIVATION/);
});

test('Worker bundle and Wrangler expose Firebase Auth with the distinct SQLite authority', () => {
  assert.match(worker, /AdmissionAuthAuthority/);
  assert.match(worker, /createNativeAuthHandler/);
  assert.match(bundle, /AdmissionAuthAuthority/);
  assert.match(bundle, /AUTH_API_PREFIX = "\/api\/auth\/v1"/);
  assert.match(bundle, /accounts:signInWithPassword/);
  assert.match(bundle, /requestType: "VERIFY_EMAIL"/);
  assert.match(wrangler, /name = "AUTH_AUTHORITY"/);
  assert.match(wrangler, /new_sqlite_classes = \["AdmissionAuthAuthority"\]/);
  assert.match(wrangler, /FIREBASE_CONTINUE_URL = "https:\/\/admissionhub\.pages\.dev\//);
});

test('Google readiness audit is no-mutation and never prints Firebase key, client ID, or user credential', () => {
  assert.match(googleReadinessWorkflow, /inputs\.confirmation == 'AUDIT_GOOGLE_AUTH'/);
  assert.match(googleReadinessWorkflow, /secrets\.FIREBASE_WEB_API_KEY/);
  assert.match(googleReadinessWorkflow, /verify-google-readiness\.mjs/);
  assert.doesNotMatch(googleReadinessWorkflow, /wrangler[^\n]*(?:deploy|secret put)|firebase[^\n]*deploy/i);
  assert.match(googleReadinessOperation, /inspectProject\(\)/);
  assert.match(googleReadinessOperation, /inspectGoogleProvider\(\)/);
  assert.match(googleReadinessOperation, /clientIdPrinted=false keyPrinted=false credentialPrinted=false/);
  assert.doesNotMatch(googleReadinessOperation, /stdout\.write\([^\n]*\$\{(?:apiKey|key|result\.clientId|accessToken|idToken)\}/);
});

test('protected public activation audits premium onboarding in a real browser before deployment verification', () => {
  for (const workflow of [activationWorkflow, telegramCanaryWorkflow]) {
    assert.match(workflow, /playwright-core install --with-deps chromium/);
    assert.match(workflow, /npm run audit:premium-browser/);
  }
});

test('Firebase deployment recovery captures the active version and installs the secret after pinned deployment', () => {
  for (const workflow of [activationWorkflow, boundaryWorkflow]) {
    assert.match(workflow, /wrangler@4\.35\.0 deployments status --name admission-gk --json/);
    assert.doesNotMatch(workflow, /deployments list --name admission-gk|x\?\.\[0\]/);
    assert.match(workflow, /wranglerVersion: '4\.35\.0'/);
    assert.match(workflow, /failure\(\) && steps\.worker-deploy\.outcome == 'success'/);
    assert.match(workflow, /rollback "\$PREVIOUS_WORKER_VERSION"/);
  }
  const deployAt = activationWorkflow.indexOf('Deploy Worker and SQLite Auth schema fail closed');
  const secretAt = activationWorkflow.indexOf('Install Firebase Web API key on the deployed Worker version');
  const bindingAt = activationWorkflow.indexOf('Verify Firebase binding exists without reading its value');
  assert.ok(deployAt >= 0 && deployAt < secretAt && secretAt < bindingAt);
});

test('Pages excludes server-only Auth source and keeps defensive source block', () => {
  assert.match(pagesWorkflow, /--exclude='auth-native'/);
  assert.match(pagesWorker, /\/auth-native\//);
});

test('service worker keeps Auth and the privileged control page out of the offline shell', () => {
  assert.match(serviceWorker, /requestUrl\.pathname\.startsWith\('\/api\/auth\/'\)/);
  assert.match(serviceWorker, /requestUrl\.pathname === '\/verification-control-center\.html'/);
  const shell = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(shell, /verification-control-center/);
  assert.match(serviceWorker, /fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.ok(serviceWorker.indexOf("requestUrl.pathname === '/verification-control-center.html'") < serviceWorker.lastIndexOf('if (isDocumentRequest(request))'));
});
