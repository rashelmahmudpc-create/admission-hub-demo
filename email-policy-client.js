/* Browser mirror of the disposable-email denylist in email-policy.js.
 *
 * The Worker's list is authoritative: the server refuses a throwaway inbox at
 * POST /signup, so a patched client cannot skip the check. This mirror exists
 * only so the student is told at the email field instead of after a round-trip.
 *
 * email-policy.js is an ES module and the Pages bundle excludes auth-native/,
 * so the browser cannot import it. email-policy.test.mjs asserts that this list
 * is identical to the server list, which is what keeps the two from drifting.
 */
(() => {
  window.ADMISSION_HUB_DISPOSABLE_EMAILS = Object.freeze([
    'temp-mail.org', 'tempmail.com', 'tempmail.net', 'tempmail.dev', 'tempmailo.com',
    'tempmail.plus', 'temp-mail.io', 'tempmailaddress.com', '10minutemail.com',
    '10minutemail.net', '10minutemail.org', '10minemail.com', '20minutemail.com',
    'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.de',
    'sharklasers.com', 'grr.la', 'guerrillamailblock.com', 'spam4.me',
    'mailinator.com', 'mailinator.net', 'mailinator2.com', 'notmailinator.com',
    'yopmail.com', 'yopmail.fr', 'yopmail.net', 'cool.fr.nf', 'jetable.org',
    'trashmail.com', 'trashmail.net', 'trashmail.org', 'trashmail.de', 'trash-mail.com',
    'throwawaymail.com', 'throwaway.email', 'getnada.com', 'nada.email',
    'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mailcatch.com',
    'mytemp.email', 'moakt.com', 'tempr.email', 'discard.email', 'discardmail.com',
    'fakeinbox.com', 'fakemail.net', 'mail-temporaire.fr', 'emailondeck.com',
    'mohmal.com', 'mohmal.im', 'luxusmail.org', 'emailfake.com', 'crazymailing.com',
    'generator.email', 'tempinbox.com', 'tempinbox.co', 'spamgourmet.com',
    'mailmetrash.com', 'mailsac.com', 'inboxkitten.com', 'harakirimail.com',
    'mailforspam.com', 'tempmailer.com', 'tempmailer.de', 'tempemail.net',
    'burnermail.io', 'anonaddy.com', '33mail.com', 'mailpoof.com',
    'smailpro.com', 'vomoto.com', 'eyepaste.com', '1secmail.com', '1secmail.net',
    '1secmail.org', '1secmail.ru', 'tuta.io', 'tempmail.email', 'tempmailbox.net',
    'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'internet.ru'
  ]);
  window.ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS = Object.freeze(['gmail.com', 'yahoo.com', 'icloud.com', 'outlook.com']);
  window.ADMISSION_HUB_DISPOSABLE_EMAIL_MESSAGE =
    'শুধু Gmail, Yahoo, iCloud বা Outlook ইমেইল দিয়ে এগোনো যাবে। অন্য কোনো ইমেইল গ্রহণ করা হয় না।';
  window.ADMISSION_HUB_isDisposableEmail = value => {
    const text = String(value || '').trim().toLowerCase();
    const at = text.lastIndexOf('@');
    if (at < 0 || at === text.length - 1) return false;
    const domain = text.slice(at + 1).replace(/\.+$/, '');
    return !window.ADMISSION_HUB_ALLOWED_EMAIL_DOMAINS.includes(domain);
  };
})();
