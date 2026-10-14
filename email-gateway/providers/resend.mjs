import { ProviderAdapter } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES } from '../core/constants.mjs';

export class ResendProvider extends ProviderAdapter {
  #apiKey; #fromAddress; #fromName;
  constructor({ apiKey, fromAddress, fromName = 'AdmissionSky', fetchImpl }) {
    super({ id: 'resend', name: 'Resend', fetchImpl, capabilities: [PROVIDER_CAPABILITIES.API, PROVIDER_CAPABILITIES.TRANSACTIONAL, PROVIDER_CAPABILITIES.HTML, PROVIDER_CAPABILITIES.TEXT, PROVIDER_CAPABILITIES.CUSTOM_DOMAIN, PROVIDER_CAPABILITIES.WEBHOOKS, PROVIDER_CAPABILITIES.DELIVERY_EVENTS, PROVIDER_CAPABILITIES.IDEMPOTENCY] });
    this.#apiKey = String(apiKey || ''); this.#fromAddress = String(fromAddress || ''); this.#fromName = String(fromName || 'AdmissionSky');
  }
  async verifyConfiguration() { return Object.freeze({ configured: Boolean(this.#apiKey && this.#fromAddress), missing: [!this.#apiKey && 'apiKey', !this.#fromAddress && 'fromAddress'].filter(Boolean) }); }
  checkHealth(context = {}) {
    const senderDomain = this.#fromAddress.split('@').pop()?.toLowerCase();
    return this.probeHttp({
      url: 'https://api.resend.com/domains', signal: context.signal,
      headers: { Authorization: `Bearer ${this.#apiKey}` },
      mapResult: data => {
        const domain = Array.isArray(data?.data) ? data.data.find(item => String(item?.name || '').toLowerCase() === senderDomain) : null;
        const senderVerified = Boolean(domain && domain.status === 'verified' && domain.capabilities?.sending !== 'disabled');
        return { status: senderVerified ? 'HEALTHY' : 'DEGRADED', senderVerified };
      }
    });
  }
  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://api.resend.com/emails', signal: context.signal, requestId: context.requestId, deliveryAttemptId: context.deliveryAttemptId,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#apiKey}`, 'Idempotency-Key': context.idempotencyKey },
      body: { from: `${this.#fromName} <${this.#fromAddress}>`, to: [message.recipient], subject: message.subject, html: message.html, text: message.text },
      mapResponse: data => ({ providerMessageId: data?.id })
    });
  }
}
