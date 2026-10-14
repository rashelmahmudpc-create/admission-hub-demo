import { ProviderAdapter } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES } from '../core/constants.mjs';

export class ElasticEmailProvider extends ProviderAdapter {
  #apiKey; #fromAddress; #fromName;
  constructor({ apiKey, fromAddress, fromName = 'AdmissionSky', fetchImpl }) {
    super({ id: 'elasticemail', name: 'Elastic Email', fetchImpl, capabilities: [PROVIDER_CAPABILITIES.API, PROVIDER_CAPABILITIES.SMTP, PROVIDER_CAPABILITIES.TRANSACTIONAL, PROVIDER_CAPABILITIES.HTML, PROVIDER_CAPABILITIES.TEXT, PROVIDER_CAPABILITIES.CUSTOM_DOMAIN, PROVIDER_CAPABILITIES.WEBHOOKS, PROVIDER_CAPABILITIES.DELIVERY_EVENTS] });
    this.#apiKey = String(apiKey || ''); this.#fromAddress = String(fromAddress || ''); this.#fromName = String(fromName || 'AdmissionSky');
  }
  async verifyConfiguration() { return Object.freeze({ configured: Boolean(this.#apiKey && this.#fromAddress), missing: [!this.#apiKey && 'apiKey', !this.#fromAddress && 'fromAddress'].filter(Boolean) }); }
  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://api.elasticemail.com/v4/emails/transactional', signal: context.signal, requestId: context.requestId,
      headers: { 'Content-Type': 'application/json', 'X-ElasticEmail-ApiKey': this.#apiKey },
      body: { Recipients: { To: [message.recipient] }, Content: { From: `${this.#fromName} <${this.#fromAddress}>`, Subject: message.subject, Body: [{ ContentType: 'HTML', Charset: 'utf-8', Content: message.html }, { ContentType: 'PlainText', Charset: 'utf-8', Content: message.text }] } },
      mapResponse: data => ({ providerMessageId: data?.TransactionID || data?.MessageID })
    });
  }
}
