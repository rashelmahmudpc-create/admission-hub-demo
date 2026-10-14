import { ProviderAdapter } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES, DELIVERY_STATES } from '../core/constants.mjs';

export class SendGridProvider extends ProviderAdapter {
  #apiKey; #fromAddress; #fromName;
  constructor({ apiKey, fromAddress, fromName = 'AdmissionSky', fetchImpl }) {
    super({ id: 'sendgrid', name: 'SendGrid', fetchImpl, capabilities: [PROVIDER_CAPABILITIES.API, PROVIDER_CAPABILITIES.TRANSACTIONAL, PROVIDER_CAPABILITIES.HTML, PROVIDER_CAPABILITIES.TEXT, PROVIDER_CAPABILITIES.CUSTOM_DOMAIN, PROVIDER_CAPABILITIES.WEBHOOKS, PROVIDER_CAPABILITIES.DELIVERY_EVENTS] });
    this.#apiKey = String(apiKey || ''); this.#fromAddress = String(fromAddress || ''); this.#fromName = String(fromName || 'AdmissionSky');
  }
  async verifyConfiguration() { return Object.freeze({ configured: Boolean(this.#apiKey && this.#fromAddress), missing: [!this.#apiKey && 'apiKey', !this.#fromAddress && 'fromAddress'].filter(Boolean) }); }
  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://api.sendgrid.com/v3/mail/send', signal: context.signal, requestId: context.requestId,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#apiKey}` },
      body: { personalizations: [{ to: [{ email: message.recipient }], subject: message.subject, custom_args: { request_ref: context.requestRef } }], from: { email: this.#fromAddress, name: this.#fromName }, content: [{ type: 'text/plain', value: message.text }, { type: 'text/html', value: message.html }] },
      mapResponse: (_data, response) => ({ status: DELIVERY_STATES.ACCEPTED, providerMessageId: response.headers.get('X-Message-Id') })
    });
  }
}
