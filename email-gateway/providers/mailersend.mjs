import { ProviderAdapter } from './base-provider.mjs';
import { EMAIL_FAILURE_CODES, PROVIDER_CAPABILITIES } from '../core/constants.mjs';
import { EmailGatewayError } from '../core/errors.mjs';

export class MailerSendProvider extends ProviderAdapter {
  #apiKey; #fromAddress; #fromName;
  constructor({ apiKey, fromAddress, fromName = 'AdmissionSky', fetchImpl }) {
    super({ id: 'mailersend', name: 'MailerSend', fetchImpl, capabilities: [
      PROVIDER_CAPABILITIES.API, PROVIDER_CAPABILITIES.TRANSACTIONAL,
      PROVIDER_CAPABILITIES.HTML, PROVIDER_CAPABILITIES.TEXT,
      PROVIDER_CAPABILITIES.CUSTOM_DOMAIN, PROVIDER_CAPABILITIES.WEBHOOKS,
      PROVIDER_CAPABILITIES.DELIVERY_EVENTS
    ] });
    this.#apiKey = String(apiKey || '');
    this.#fromAddress = String(fromAddress || '');
    this.#fromName = String(fromName || 'AdmissionSky');
  }

  async verifyConfiguration() {
    return Object.freeze({ configured: Boolean(this.#apiKey && this.#fromAddress), missing: [!this.#apiKey && 'apiKey', !this.#fromAddress && 'fromAddress'].filter(Boolean) });
  }

  checkHealth(context = {}) {
    const senderDomain = this.#fromAddress.split('@').pop()?.toLowerCase();
    return this.probeHttp({
      url: 'https://api.mailersend.com/v1/domains?limit=100', signal: context.signal,
      headers: { Authorization: `Bearer ${this.#apiKey}` },
      mapResult: data => {
        const domain = Array.isArray(data?.data) ? data.data.find(item => String(item?.name || '').toLowerCase() === senderDomain) : null;
        const senderVerified = Boolean(domain && (domain.is_verified === true || domain.status === 'verified'));
        return { status: senderVerified ? 'HEALTHY' : 'DEGRADED', senderVerified };
      }
    });
  }

  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://api.mailersend.com/v1/email', signal: context.signal, requestId: context.requestId, deliveryAttemptId: context.deliveryAttemptId,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#apiKey}` },
      body: {
        from: { email: this.#fromAddress, name: this.#fromName },
        to: [{ email: message.recipient }],
        subject: message.subject,
        text: message.text,
        html: message.html
      },
      mapResponse: (data, response) => {
        if (response.headers.get('x-send-paused') === 'true') throw new EmailGatewayError({ code: EMAIL_FAILURE_CODES.PROVIDER_SUSPENDED, providerId: this.id, dispatched: true, uncertain: false });
        if (Array.isArray(data?.warnings) && data.warnings.some(item => item?.type === 'ALL_SUPPRESSED')) throw new EmailGatewayError({ code: EMAIL_FAILURE_CODES.RECIPIENT_REJECTED, providerId: this.id, dispatched: true, uncertain: false });
        return { providerMessageId: response.headers.get('X-Message-Id') || response.headers.get('x-message-id') };
      }
    });
  }
}
