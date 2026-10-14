/**
 * AdmissionSky — verification mailer (Google Apps Script web app).
 *
 * Delivers AdmissionSky account-verification codes by email, free of charge,
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
      subject: 'AdmissionSky — যাচাইকরণ কোড',
      name: 'AdmissionSky',
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
    'AdmissionSky',
    '',
    'আপনার AdmissionSky অ্যাকাউন্ট যাচাই করতে নিচের কোডটি ব্যবহার করুন।',
    '',
    '    ' + code,
    '',
    'কোডটি ' + minutes + ' মিনিট পর্যন্ত কার্যকর থাকবে। কাউকে শেয়ার করবেন না।',
    '',
    'শুভেচ্ছান্তে,',
    'AdmissionSky Team',
    '',
    '--',
    'AdmissionSky',
    'Your Admission Companion',
    'এটি একটি স্বয়ংক্রিয় বার্তা। এই ইমেইলে উত্তর দেওয়ার প্রয়োজন নেই।'
  ].join('\n');
}

/** Branded, table-based layout that survives Gmail, Outlook and mobile clients. */
function otpEmailHtml_(code, minutes) {
  var ink = '#101c19';
  var inkSoft = '#48534f';
  var muted = '#8b9491';
  var brandInk = '#0f8a63';
  var brandFill = '#12a876';
  var line = '#cdeede';
  var surface = '#ffffff';
  var canvas = '#f2fbf7';
  var accent = '#2F6BFF';
  var mono = '\'SF Mono\',\'Roboto Mono\',\'DejaVu Sans Mono\',Menlo,Consolas,\'Courier New\',monospace';
  var sans = '\'Hind Siliguri\',\'Noto Sans Bengali\',\'Nirmala UI\',-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif';
  var mark = 'https://admissionsky.pages.dev/icons/email-mark.png';

  return '<!DOCTYPE html><html lang="bn"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="x-apple-disable-message-reformatting">' +
    '<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">' +
    '<meta name="color-scheme" content="light dark">' +
    '<meta name="supported-color-schemes" content="light dark">' +
    '<title>AdmissionSky — ইমেইল যাচাইকরণ</title></head>' +
    '<body style="margin:0;padding:0;width:100%;background-color:' + surface + ';font-family:' + sans + ';color:' + ink + ';">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;font-size:1px;line-height:1px;">' +
    'আপনার AdmissionSky যাচাইকরণ কোড: ' + code + ' — ' + minutes + ' মিনিটের জন্য কার্যকর।</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;background-color:' + surface + ';">' +
    '<tr><td align="center" style="padding:28px 12px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;background-color:' + surface + ';border-radius:16px;">' +

    '<tr><td style="padding:30px 28px 0;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="52" valign="middle" style="width:52px;">' +
    '<img src="' + mark + '" width="52" height="52" alt="AdmissionSky" style="display:block;width:52px;height:52px;border:0;border-radius:16px;" /></td>' +
    '<td valign="middle" style="padding-left:13px;font-family:' + sans + ';font-size:22px;line-height:1.2;font-weight:700;color:' + ink + ';letter-spacing:-0.2px;">' +
    'Admission<span style="color:' + accent + ';">Sky</span></td>' +
    '</tr></table></td></tr>' +

    '<tr><td style="padding:22px 28px 0;">' +
    '<p style="margin:0;font-family:' + sans + ';font-size:20px;line-height:1.5;font-weight:600;color:' + ink + ';">প্রিয় ব্যবহারকারী,</p>' +
    '<p style="margin:10px 0 0;font-family:' + sans + ';font-size:15px;line-height:1.7;font-weight:400;color:' + inkSoft + ';">' +
    'আপনার AdmissionSky অ্যাকাউন্ট যাচাই করতে নিচের কোডটি ব্যবহার করুন।</p></td></tr>' +

    '<tr><td style="padding:26px 28px 0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + canvas + '" style="width:100%;background-color:' + canvas + ';border:1px solid ' + line + ';border-radius:16px;">' +
    '<tr><td align="center" style="padding:30px 16px;">' +
    '<p style="margin:0;font-family:' + mono + ';font-size:48px;line-height:1.1;font-weight:700;letter-spacing:10px;text-indent:10px;color:' + ink + ';">' + code + '</p>' +
    '</td></tr></table></td></tr>' +

    '<tr><td align="center" style="padding:16px 28px 0;">' +
    '<p style="margin:0;font-family:' + sans + ';font-size:13px;line-height:1.6;font-weight:400;color:' + muted + ';">' +
    'এই কোডটি ' + minutes + ' মিনিট পর্যন্ত কার্যকর থাকবে।</p></td></tr>' +

    '<tr><td align="center" style="padding:10px 28px 30px;">' +
    '<p style="margin:0;font-family:' + sans + ';font-size:12.5px;line-height:1.65;font-weight:400;color:' + muted + ';">' +
    'কোডটি কারও সঙ্গে শেয়ার করবেন না। AdmissionSky-এর কেউ কখনও আপনার কোড চাইবে না।</p></td></tr>' +

    '<tr><td style="padding:18px 28px 26px;border-top:1px solid #eff2f1;">' +
    '<p style="margin:0;font-family:' + sans + ';font-size:12px;line-height:1.5;font-weight:600;color:#3f4a47;">AdmissionSky</p>' +
    '<p style="margin:3px 0 0;font-family:' + sans + ';font-size:11px;line-height:1.5;font-weight:400;color:' + muted + ';">Your Admission Companion</p>' +
    '<p style="margin:12px 0 0;font-family:' + sans + ';font-size:11px;line-height:1.6;font-weight:400;color:#9aa3a0;">' +
    'এটি একটি স্বয়ংক্রিয় বার্তা। এই ইমেইলে উত্তর দেওয়ার প্রয়োজন নেই।</p>' +
    '<p style="margin:10px 0 0;font-family:' + sans + ';font-size:11px;line-height:1.6;font-weight:400;color:' + muted + ';">' +
    '<a href="https://admissionsky.pages.dev" style="color:' + brandInk + ';text-decoration:none;">admissionsky.pages.dev</a></p>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}
