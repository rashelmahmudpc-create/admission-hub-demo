import { pathToFileURL } from 'node:url';
import { notifyTelegramFromEnvironment } from './telegram-notifier.mjs';

export async function runTelegramNotificationCli({ env = process.env, argv = process.argv.slice(2), fetchImpl = globalThis.fetch, stdout = process.stdout, stderr = process.stderr } = {}) {
  const status = String(env.ADMISSION_HUB_NOTIFICATION_STATUS || argv[0] || 'COMPLETED').toUpperCase();
  const summary = env.ADMISSION_HUB_NOTIFICATION_SUMMARY || argv.slice(1).join(' ') || 'AdmissionSky task completed.';
  const details = String(env.ADMISSION_HUB_NOTIFICATION_DETAILS || '').split('|').map(value => value.trim()).filter(Boolean);
  try {
    const result = await notifyTelegramFromEnvironment({ env, fetchImpl, notification: { status, summary, details } });
    stdout.write(`TELEGRAM_NOTIFICATION_SENT messageId=${result.messageId}\n`);
    return 0;
  } catch (error) {
    if (error?.code === 'REQUIRED_SECRET_NOT_CONFIGURED') {
      stdout.write('BLOCKED — REQUIRED_SECRET_NOT_CONFIGURED\nRequired integration: Telegram completion notification\nRequired configuration: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID\nExpected location: authorized environment/secret manager\nImplementation status: notifier schema, validation, bounded API transport and acceptance verification completed\n');
      return 2;
    }
    stderr.write(`TELEGRAM_NOTIFICATION_FAILED code=${String(error?.code || 'UNKNOWN').slice(0, 80)}\n`);
    return 1;
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) process.exitCode = await runTelegramNotificationCli();
