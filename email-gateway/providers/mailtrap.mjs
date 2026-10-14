import { ProviderAdapter } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES } from '../core/constants.mjs';

export class MailtrapProvider extends ProviderAdapter {
  #apiKey; #fromAddress; #fromName;
  constructor({ apiKey, fromAddress, fromName = 'AdmissionSky', fetchImpl }) {
    super({ id: 'mailtrap', name: 'Mailtrap', fetchImpl, capabilities: [
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
    const today = new Date().toISOString().slice(0, 10);
    return this.probeHttp({
      url: `https://mailtrap.io/api/stats/domains?start_date=${today}&end_date=${today}`, signal: context.signal,
      headers: { Authorization: `Bearer ${this.#apiKey}` },
      mapResult: data => ({ status: data && typeof data === 'object' ? 'HEALTHY' : 'DEGRADED' })
    });
  }

  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://send.api.mailtrap.io/api/send', signal: context.signal, requestId: context.requestId, deliveryAttemptId: context.deliveryAttemptId,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#apiKey}` },
      body: {
        from: { email: this.#fromAddress, name: this.#fromName },
        to: [{ email: message.recipient }],
        subject: message.subject,
        text: message.text,
        html: message.html
      },
      mapResponse: data => ({ providerMessageId: data?.message_ids?.[0] })
    });
  }
}
