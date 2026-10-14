import { ProviderAdapter } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES } from '../core/constants.mjs';
import { bytesToBase64, utf8 } from '../core/crypto.mjs';

export class SendPulseProvider extends ProviderAdapter {
  #apiKey; #fromAddress; #fromName;
  constructor({ apiKey, fromAddress, fromName = 'AdmissionSky', fetchImpl }) {
    super({ id: 'sendpulse', name: 'SendPulse', fetchImpl, capabilities: [
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
    return this.probeHttp({
      url: 'https://api.sendpulse.com/smtp/senders', signal: context.signal,
      headers: { Authorization: `Bearer ${this.#apiKey}` },
      mapResult: data => {
        const sender = Array.isArray(data) ? data.find(item => (typeof item === 'string' ? item : item?.email) === this.#fromAddress) : null;
        const senderVerified = Boolean(sender && (typeof sender === 'string' || sender.status === 'Active' || sender.status === 1 || sender.is_allowed_for_smtp === true));
        return { status: senderVerified ? 'HEALTHY' : 'DEGRADED', senderVerified };
      }
    });
  }

  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://api.sendpulse.com/smtp/emails', signal: context.signal, requestId: context.requestId, deliveryAttemptId: context.deliveryAttemptId,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#apiKey}` },
      body: {
        email: {
          html: bytesToBase64(utf8(message.html)),
          text: message.text,
          subject: message.subject,
          from: { name: this.#fromName, email: this.#fromAddress },
          to: [{ email: message.recipient }]
        }
      },
      mapResponse: data => ({ providerMessageId: data?.result === true ? data?.id : null })
    });
  }
}
