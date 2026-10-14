import { ProviderAdapter } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES } from '../core/constants.mjs';

export class Smtp2GoProvider extends ProviderAdapter {
  #apiKey; #fromAddress; #fromName;
  constructor({ apiKey, fromAddress, fromName = 'AdmissionSky', fetchImpl }) {
    super({ id: 'smtp2go', name: 'SMTP2GO', fetchImpl, capabilities: [PROVIDER_CAPABILITIES.API, PROVIDER_CAPABILITIES.SMTP, PROVIDER_CAPABILITIES.TRANSACTIONAL, PROVIDER_CAPABILITIES.HTML, PROVIDER_CAPABILITIES.TEXT, PROVIDER_CAPABILITIES.CUSTOM_DOMAIN, PROVIDER_CAPABILITIES.WEBHOOKS, PROVIDER_CAPABILITIES.DELIVERY_EVENTS] });
    this.#apiKey = String(apiKey || ''); this.#fromAddress = String(fromAddress || ''); this.#fromName = String(fromName || 'AdmissionSky');
  }
  async verifyConfiguration() { return Object.freeze({ configured: Boolean(this.#apiKey && this.#fromAddress), missing: [!this.#apiKey && 'apiKey', !this.#fromAddress && 'fromAddress'].filter(Boolean) }); }
  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://api.smtp2go.com/v3/email/send', signal: context.signal, requestId: context.requestId,
      headers: { 'Content-Type': 'application/json', 'X-Smtp2go-Api-Key': this.#apiKey },
      body: { sender: `${this.#fromName} <${this.#fromAddress}>`, to: [message.recipient], subject: message.subject, text_body: message.text, html_body: message.html, custom_headers: [{ header: 'X-AH-Request-Ref', value: context.requestRef }] },
      mapResponse: data => ({ providerMessageId: data?.data?.email_id || data?.data?.succeeded?.[0] })
    });
  }
}
