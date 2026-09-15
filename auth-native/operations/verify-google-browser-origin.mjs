import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LIVE_URL = 'https://admissionhub.pages.dev/';
const GOOGLE_HOST = 'accounts.google.com';
const BROWSER_PATHS = Object.freeze([
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome'
]);

export class GoogleBrowserOriginError extends Error {
  constructor(code = 'GOOGLE_BROWSER_ORIGIN_FAILED') {
    const safeCode = String(code || 'GOOGLE_BROWSER_ORIGIN_FAILED')
      .toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 80);
    super(safeCode);
    this.name = 'GoogleBrowserOriginError';
    this.code = safeCode;
  }
}

export function classifyGoogleBrowserPage({ url = '', text = '', consoleMismatch = false } = {}) {
  let googlePage = false;
  try {
    const parsed = new URL(String(url || ''));
    googlePage = parsed.protocol === 'https:' && parsed.hostname === GOOGLE_HOST;
  } catch {}
  const boundedText = String(text || '').slice(0, 20_000);
  const mismatch = consoleMismatch === true || /origin_mismatch|given origin is not allowed/i.test(boundedText);
  const rejected = /Access blocked\s*:\s*Authorization Error|Error 403|rate_limit_exceeded|temporarily disabled/i.test(boundedText);
  return Object.freeze({
    ready: googlePage && !mismatch && !rejected && boundedText.trim().length > 0,
    googlePage,
    mismatch,
    rejected
  });
}

const browserExecutable = env => {
  const requested = String(env?.GOOGLE_BROWSER_EXECUTABLE || '');
  if (requested && existsSync(requested)) return requested;
  return BROWSER_PATHS.find(existsSync) || '';
};

export async function verifyGoogleBrowserOrigin({ chromiumImpl, env = process.env } = {}) {
  const chromium = chromiumImpl || (await import('playwright-core')).chromium;
  const executablePath = browserExecutable(env);
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  }).catch(() => { throw new GoogleBrowserOriginError('BROWSER_LAUNCH_FAILED'); });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      locale: 'en-US'
    });
    const page = await context.newPage();
    let consoleMismatch = false;
    page.on('console', message => {
      if (/origin_mismatch|given origin is not allowed/i.test(String(message.text() || ''))) consoleMismatch = true;
    });
    await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('.ah-account-page', { state: 'attached', timeout: 30_000 });
    const firstEntryWelcome = await page.locator('[data-view="welcome"]').isVisible().catch(() => false);
    if (!firstEntryWelcome) {
      await page.waitForFunction(() => typeof window.AdmissionAccount?.open === 'function', null, { timeout: 30_000 });
      await page.evaluate(() => window.AdmissionAccount.open());
    }
    const googleFrameSelector =
      '[data-role="welcome-google-button"] iframe:visible, [data-role="google-button"] iframe:visible';
    const googleFrame = page.locator(googleFrameSelector).first();
    await googleFrame.waitFor({ state: 'visible', timeout: 30_000 });
    const googleButton = page.frameLocator(googleFrameSelector).first().locator('[role="button"]').first();
    await googleButton.waitFor({ state: 'visible', timeout: 20_000 });
    const pagesBeforeClick = new Set(context.pages());
    const popupPromise = context.waitForEvent('page', { timeout: 20_000 }).catch(() => null);
    await googleButton.click({ timeout: 20_000 });
    const popup = await popupPromise || context.pages().find(candidate => !pagesBeforeClick.has(candidate));
    if (!popup) throw new GoogleBrowserOriginError('GOOGLE_CHALLENGE_NOT_OPENED');
    await popup.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
    await popup.waitForTimeout(2_500);
    const result = classifyGoogleBrowserPage({
      url: popup.url(),
      text: await popup.locator('body').innerText({ timeout: 10_000 }).catch(() => ''),
      consoleMismatch
    });
    if (result.mismatch) throw new GoogleBrowserOriginError('GOOGLE_ORIGIN_MISMATCH');
    if (!result.ready) throw new GoogleBrowserOriginError('GOOGLE_CHALLENGE_REJECTED');
    await context.close();
    return Object.freeze({ ready: true, originAccepted: true, credentialUsed: false });
  } catch (cause) {
    if (cause instanceof GoogleBrowserOriginError) throw cause;
    throw new GoogleBrowserOriginError();
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main({ env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const result = await verifyGoogleBrowserOrigin({ env });
    stdout.write(`GOOGLE_BROWSER_ORIGIN status=READY originAccepted=${result.originAccepted} credentialUsed=${result.credentialUsed} clientIdPrinted=false urlPrinted=false credentialPrinted=false\n`);
  } catch (cause) {
    const safe = cause instanceof GoogleBrowserOriginError ? cause : new GoogleBrowserOriginError();
    stderr.write(`::error title=Google browser origin check failed::code=${safe.code} clientIdPrinted=false urlPrinted=false credentialPrinted=false\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) main();
