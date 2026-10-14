import { ProviderAdapter, basicAuthorization } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES } from '../core/constants.mjs';

export class MailgunProvider extends ProviderAdapter {
  #apiKey; #domain; #fromAddress; #fromName; #apiBase;
  constructor({ apiKey, domain, fromAddress, fromName = 'AdmissionSky', apiBase = 'https://api.mailgun.net', fetchImpl }) {
    super({ id: 'mailgun', name: 'Mailgun', fetchImpl, capabilities: [PROVIDER_CAPABILITIES.API, PROVIDER_CAPABILITIES.TRANSACTIONAL, PROVIDER_CAPABILITIES.HTML, PROVIDER_CAPABILITIES.TEXT, PROVIDER_CAPABILITIES.CUSTOM_DOMAIN, PROVIDER_CAPABILITIES.WEBHOOKS, PROVIDER_CAPABILITIES.DELIVERY_EVENTS] });
    this.#apiKey = String(apiKey || ''); this.#domain = String(domain || ''); this.#fromAddress = String(fromAddress || ''); this.#fromName = String(fromName || 'AdmissionSky'); this.#apiBase = String(apiBase || 'https://api.mailgun.net').replace(/\/$/, '');
  }
  async verifyConfiguration() {
    const apiBaseValid = ['https://api.mailgun.net', 'https://api.eu.mailgun.net'].includes(this.#apiBase);
    return Object.freeze({ configured: Boolean(this.#apiKey && this.#domain && this.#fromAddress && apiBaseValid), missing: [!this.#apiKey && 'apiKey', !this.#domain && 'domain', !this.#fromAddress && 'fromAddress', !apiBaseValid && 'apiBase'].filter(Boolean) });
  }
  sendEmail(message, context = {}) {
    const form = new FormData();
    form.set('from', `${this.#fromName} <${this.#fromAddress}>`); form.set('to', message.recipient); form.set('subject', message.subject); form.set('text', message.text); form.set('html', message.html); form.set('v:request_ref', context.requestRef);
    return this.sendHttp({
      url: `${this.#apiBase}/v3/${encodeURIComponent(this.#domain)}/messages`, signal: context.signal, requestId: context.requestId,
      headers: { Authorization: basicAuthorization('api', this.#apiKey) }, body: form,
      mapResponse: data => ({ providerMessageId: data?.id })
    });
  }
}
