import { ProviderAdapter } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES } from '../core/constants.mjs';

export class CourierProvider extends ProviderAdapter {
  #apiKey; #fromAddress; #fromName;
  constructor({ apiKey, fromAddress, fromName = 'AdmissionSky', fetchImpl }) {
    super({ id: 'courier', name: 'Courier', fetchImpl, capabilities: [
      PROVIDER_CAPABILITIES.API, PROVIDER_CAPABILITIES.TRANSACTIONAL,
      PROVIDER_CAPABILITIES.HTML, PROVIDER_CAPABILITIES.TEXT,
      PROVIDER_CAPABILITIES.WEBHOOKS, PROVIDER_CAPABILITIES.DELIVERY_EVENTS,
      PROVIDER_CAPABILITIES.IDEMPOTENCY
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
      url: 'https://api.courier.com/messages?limit=1', signal: context.signal,
      headers: { Authorization: `Bearer ${this.#apiKey}` },
      mapResult: data => ({ status: data && typeof data === 'object' ? 'HEALTHY' : 'DEGRADED' })
    });
  }

  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://api.courier.com/send', signal: context.signal, requestId: context.requestId, deliveryAttemptId: context.deliveryAttemptId,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#apiKey}`, 'Idempotency-Key': context.idempotencyKey },
      body: {
        message: {
          to: { email: message.recipient },
          content: { title: message.subject, body: message.text },
          routing: { method: 'single', channels: ['email'] },
          channels: {
            email: {
              override: {
                subject: message.subject,
                from: `${this.#fromName} <${this.#fromAddress}>`,
                html: message.html,
                text: message.text,
                tracking: { open: false }
              }
            }
          }
        }
      },
      mapResponse: data => ({ providerMessageId: data?.requestId || data?.request_id })
    });
  }
}
