/**
 * Admission Hub — verification mailer (Google Apps Script web app).
 *
 * Delivers Admission Hub account-verification codes by email, free of charge,
 * inside the consumer quota of 100 recipients/day (1,500 on Google Workspace).
 *
 * The Worker holds the shared secret and signs every call; this script is the
 * only place that can send. Nothing here trusts the body of a request until the
 * HMAC over the canonical string, the timestamp skew and the single-use nonce
 * have all been checked.
 *
 * Deploy: standalone script at script.google.com, then
 *   Deploy > New deployment > Web app
 *     Execute as:      Me
 *     Who has access:  Anyone
 * then copy the /exec URL into the Worker as OTP_B_PROVIDER_APPS_SCRIPT_URL.
 */

var MAX_CLOCK_SKEW_SECONDS = 300;
var NONCE_TTL_SECONDS = 600;
var DEFAULT_DAILY_LIMIT = 100;
var CODE_PATTERN = /^[0-9]{6}$/;

function doGet(event) {
  var parameters = (event && event.parameter) || {};
  var action = String(parameters.action || 'health');
  if (action !== 'health' && action !== 'quota') return jsonResponse({ ok: false, error: 'not-found' }, 404);
  if (!verifySignature_(action, parameters)) return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  if (action === 'quota') return jsonResponse(quotaSnapshot_());
  return jsonResponse({
    ok: true,
    ready: properties_().getProperty('SHARED_SECRET') ? true : false,
    quota: quotaSnapshot_()
  });
}

function doPost(event) {
  var raw = (event && event.postData && event.postData.contents) || '';
  var body;
  try { body = JSON.parse(raw); } catch (_) { return jsonResponse({ ok: false, error: 'invalid-json' }, 400); }
  if (!verifySignature_('send', body)) return jsonResponse({ ok: false, error: 'forbidden' }, 403);

  var destination = String(body.destination || '');
  var code = String(body.code || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(destination) || destination.length > 254) {
    return jsonResponse({ ok: false, error: 'invalid-recipient' }, 400);
  }
  if (!CODE_PATTERN.test(code)) return jsonResponse({ ok: false, error: 'invalid-code' }, 400);

  var remaining = MailApp.getRemainingDailyQuota();
  if (remaining <= 0) return jsonResponse({ ok: false, error: 'quota-exhausted' }, 429);

  var expiresAt = Number(body.expiresAt || 0);
  var minutes = expiresAt > 0 ? Math.max(1, Math.round((expiresAt - Date.now()) / 60000)) : 5;

  try {
    MailApp.sendEmail({
      to: destination,
      subject: 'Admission Hub — verification code',
      name: 'Admission Hub',
      htmlBody: otpEmailHtml_(code, minutes),
      body: otpEmailText_(code, minutes)
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: 'delivery-failed' }, 502);
  }

  return jsonResponse({
    ok: true,
    accepted: true,
    messageRef: 'gmail-' + Utilities.getUuid(),
    remaining: Math.max(0, remaining - 1)
  });
}

function verifySignature_(action, parameters) {
  var secret = properties_().getProperty('SHARED_SECRET');
  if (!secret || secret.length < 32) return false;

  var timestamp = String(parameters.timestamp || '');
  var nonce = String(parameters.nonce || '');
  var signature = String(parameters.signature || '');
  if (!/^[0-9]{10,13}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return false;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(signature)) return false;

  var seconds = Number(timestamp);
  if (timestamp.length === 13) seconds = Math.floor(seconds / 1000);
  if (Math.abs(Math.floor(Date.now() / 1000) - seconds) > MAX_CLOCK_SKEW_SECONDS) return false;

  var cache = CacheService.getScriptCache();
  if (cache.get('n:' + nonce)) return false;

  if (!constantTimeEqual_(signatureFor_(secret, action, parameters), signature)) return false;

  cache.put('n:' + nonce, '1', NONCE_TTL_SECONDS);
  return true;
}

/**
 * Canonical string is shared with the Worker; both sides must agree exactly.
 * Fields are joined with "\n" in a fixed order and empty fields are kept, so a
 * missing value can never be smuggled into another position.
 */
function signatureFor_(secret, action, parameters) {
  var fields = [
    action,
    String(parameters.timestamp || ''),
    String(parameters.nonce || ''),
    String(parameters.destination || ''),
    String(parameters.code || '')
  ];
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(fields.join('\n'), secret)
  ).replace(/=+$/, '');
}

function constantTimeEqual_(left, right) {
  var a = String(left || '');
  var b = String(right || '');
  if (a.length !== b.length) return false;
  var mismatch = 0;
  for (var index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

/**
 * Google resets the email quota 24 hours after the first request of the day, so
 * the reset instant is derived from the stored first-request stamp rather than
 * from midnight. The Worker needs a real resetAt to schedule its own budget.
 */
function quotaSnapshot_() {
  var store = properties_();
  var limit = Number(store.getProperty('DAILY_LIMIT') || DEFAULT_DAILY_LIMIT);
  if (!(limit > 0)) limit = DEFAULT_DAILY_LIMIT;
  var windowStart = Number(store.getProperty('WINDOW_START') || 0);
  var now = Date.now();
  if (!windowStart || now - windowStart >= 86400000) {
    windowStart = now;
    store.setProperty('WINDOW_START', String(now));
  }
  return {
    ok: true,
    remaining: Math.max(0, MailApp.getRemainingDailyQuota()),
    limit: limit,
    resetAt: windowStart + 86400000
  };
}

function properties_() {
  return PropertiesService.getScriptProperties();
}

function jsonResponse(payload) {
  var output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/** Plain-text alternative, so clients that refuse HTML still read the code. */
function otpEmailText_(code, minutes) {
  return [
    'Admission Hub',
    '',
    'তোমার verification code: ' + code,
    '',
    'কোডটি ' + minutes + ' মিনিটের মধ্যে ব্যবহার করতে হবে।',
    'এই কোডটি কারো সাথে শেয়ার করবেন না। Admission Hub-এর কেউ কখনো এই কোড চাইবে না।',
    '',
    'তুমি যদি এই verification-এর অনুরোধ না করে থাকো, এই email-টি উপেক্ষা করুন।'
  ].join('\n');
}

/** Branded, table-based layout that survives Gmail, Outlook and mobile clients. */
function otpEmailHtml_(code, minutes) {
  var ink = '#123d35';
  var inkSoft = '#5d7a72';
  var brandInk = '#0f8a63';
  var brandFill = '#12a876';
  var line = '#c8e8dc';
  var surface = '#ffffff';
  var canvas = '#f4fbf8';
  var mono = 'Consolas,Menlo,\'Courier New\',monospace';
  var sans = '-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'Noto Sans Bengali\',sans-serif';

  var digits = String(code).split('').map(function (digit) {
    return '<td style="padding:0 5px;">' +
      '<span style="display:inline-block;width:44px;height:54px;line-height:54px;background:' + surface + ';' +
      'border:1px solid ' + line + ';border-radius:12px;text-align:center;font-family:' + mono + ';' +
      'font-size:28px;font-weight:700;color:' + brandInk + ';">' + digit + '</span></td>';
  }).join('');

  return '<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light only">' +
    '<title>Admission Hub — verification code</title></head>' +
    '<body style="margin:0;padding:0;background:' + canvas + ';font-family:' + sans + ';color:' + ink + ';">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">তোমার Admission Hub verification code: ' + code + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + canvas + ';">' +
    '<tr><td align="center" style="padding:28px 14px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:' + surface + ';' +
    'border:1px solid ' + line + ';border-radius:18px;overflow:hidden;">' +

    '<tr><td style="background-color:' + brandFill + ';background-image:linear-gradient(135deg,' + brandInk + ' 0%,' + brandFill + ' 100%);padding:22px 26px;">' +
    '<p style="margin:0;font-size:19px;font-weight:700;letter-spacing:.2px;color:#ffffff;">Admission Hub</p>' +
    '<p style="margin:5px 0 0;font-size:13px;color:#e6f7f0;">তোমার অ্যাকাউন্ট যাচাই</p>' +
    '</td></tr>' +

    '<tr><td style="padding:28px 26px 8px;">' +
    '<h1 style="margin:0 0 10px;font-size:21px;line-height:1.45;color:' + ink + ';">ভেরিফিকেশন কোড</h1>' +
    '<p style="margin:0;font-size:15px;line-height:1.75;color:' + inkSoft + ';">' +
    'Admission Hub অ্যাকাউন্ট যাচাই করতে নিচের ৬ সংখ্যার কোডটি লিখুন।' +
    '</p></td></tr>' +

    '<tr><td align="center" style="padding:20px 26px 6px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' + digits + '</tr></table>' +
    '</td></tr>' +

    '<tr><td align="center" style="padding:6px 26px 22px;">' +
    '<p style="margin:0;font-size:13px;color:' + inkSoft + ';">কোডটি <strong style="color:' + ink + ';">' + minutes +
    ' মিনিট</strong>-এর মধ্যে ব্যবহার করতে হবে।</p></td></tr>' +

    '<tr><td style="padding:0 26px;"><div style="height:1px;background:' + line + ';"></div></td></tr>' +

    '<tr><td style="padding:20px 26px 26px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + canvas + ';border-radius:12px;">' +
    '<tr><td style="padding:14px 16px;">' +
    '<p style="margin:0;font-size:13px;line-height:1.7;color:' + brandInk + ';">' +
    '<strong>নিরাপত্তা:</strong> এই কোডটি কারো সাথে শেয়ার করবেন না। Admission Hub-এর পক্ষ থেকে কেউ কখনো এই কোড বা তোমার পাসওয়ার্ড চাইবে না।' +
    '</p></td></tr></table>' +
    '<p style="margin:16px 0 0;font-size:12.5px;line-height:1.7;color:' + inkSoft + ';">' +
    'তুমি যদি এই verification-এর অনুরোধ না করে থাকো, এই email-টি উপেক্ষা করুন — তোমার অ্যাকাউন্ট নিরাপদ আছে।' +
    '</p></td></tr>' +

    '<tr><td style="padding:16px 26px;background:' + canvas + ';border-top:1px solid ' + line + ';">' +
    '<p style="margin:0;font-size:12px;color:' + inkSoft + ';">Admission Hub · ' +
    '<a href="https://admissionhub.pages.dev" style="color:' + brandInk + ';text-decoration:none;">admissionhub.pages.dev</a>' +
    '</p></td></tr>' +

    '</table></td></tr></table></body></html>';
}