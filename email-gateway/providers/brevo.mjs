import { ProviderAdapter } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES } from '../core/constants.mjs';

export class BrevoProvider extends ProviderAdapter {
  #apiKey; #fromAddress; #fromName;
  constructor({ apiKey, fromAddress, fromName = 'AdmissionSky', fetchImpl }) {
    super({ id: 'brevo', name: 'Brevo', fetchImpl, capabilities: [PROVIDER_CAPABILITIES.API, PROVIDER_CAPABILITIES.TRANSACTIONAL, PROVIDER_CAPABILITIES.HTML, PROVIDER_CAPABILITIES.TEXT, PROVIDER_CAPABILITIES.CUSTOM_DOMAIN, PROVIDER_CAPABILITIES.WEBHOOKS, PROVIDER_CAPABILITIES.DELIVERY_EVENTS] });
    this.#apiKey = String(apiKey || ''); this.#fromAddress = String(fromAddress || ''); this.#fromName = String(fromName || 'AdmissionSky');
  }
  async verifyConfiguration() { return Object.freeze({ configured: Boolean(this.#apiKey && this.#fromAddress), missing: [!this.#apiKey && 'apiKey', !this.#fromAddress && 'fromAddress'].filter(Boolean) }); }
  checkHealth(context = {}) {
    return this.probeHttp({
      url: 'https://api.brevo.com/v3/senders', signal: context.signal,
      headers: { 'api-key': this.#apiKey },
      mapResult: data => {
        const sender = Array.isArray(data?.senders) ? data.senders.find(item => String(item?.email || '').toLowerCase() === this.#fromAddress.toLowerCase()) : null;
        const senderVerified = Boolean(sender?.active);
        return { status: senderVerified ? 'HEALTHY' : 'DEGRADED', senderVerified };
      }
    });
  }
  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://api.brevo.com/v3/smtp/email', signal: context.signal, requestId: context.requestId, deliveryAttemptId: context.deliveryAttemptId,
      headers: { 'Content-Type': 'application/json', 'api-key': this.#apiKey },
      body: { sender: { email: this.#fromAddress, name: this.#fromName }, to: [{ email: message.recipient }], subject: message.subject, htmlContent: message.html, textContent: message.text, tags: ['admission-hub-transactional'] },
      mapResponse: data => ({ providerMessageId: data?.messageId })
    });
  }
}
