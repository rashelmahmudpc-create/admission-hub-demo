import { ProviderAdapter } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES } from '../core/constants.mjs';

export class PostmarkProvider extends ProviderAdapter {
  #serverToken; #fromAddress; #fromName; #messageStream;
  constructor({ serverToken, fromAddress, fromName = 'AdmissionSky', messageStream = 'outbound', fetchImpl }) {
    super({ id: 'postmark', name: 'Postmark', fetchImpl, capabilities: [PROVIDER_CAPABILITIES.API, PROVIDER_CAPABILITIES.TRANSACTIONAL, PROVIDER_CAPABILITIES.HTML, PROVIDER_CAPABILITIES.TEXT, PROVIDER_CAPABILITIES.CUSTOM_DOMAIN, PROVIDER_CAPABILITIES.WEBHOOKS, PROVIDER_CAPABILITIES.DELIVERY_EVENTS] });
    this.#serverToken = String(serverToken || ''); this.#fromAddress = String(fromAddress || ''); this.#fromName = String(fromName || 'AdmissionSky'); this.#messageStream = String(messageStream || 'outbound');
  }
  async verifyConfiguration() { return Object.freeze({ configured: Boolean(this.#serverToken && this.#fromAddress), missing: [!this.#serverToken && 'serverToken', !this.#fromAddress && 'fromAddress'].filter(Boolean) }); }
  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://api.postmarkapp.com/email', signal: context.signal, requestId: context.requestId,
      headers: { 'Content-Type': 'application/json', 'X-Postmark-Server-Token': this.#serverToken },
      body: { From: `${this.#fromName} <${this.#fromAddress}>`, To: message.recipient, Subject: message.subject, TextBody: message.text, HtmlBody: message.html, MessageStream: this.#messageStream, Metadata: { request_ref: context.requestRef } },
      mapResponse: data => ({ providerMessageId: data?.MessageID })
    });
  }
}
