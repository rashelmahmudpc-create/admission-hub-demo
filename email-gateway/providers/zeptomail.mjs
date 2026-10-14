import { ProviderAdapter } from './base-provider.mjs';
import { PROVIDER_CAPABILITIES } from '../core/constants.mjs';

export class ZeptoMailProvider extends ProviderAdapter {
  #apiKey; #fromAddress; #fromName;
  constructor({ apiKey, fromAddress, fromName = 'AdmissionSky', fetchImpl }) {
    super({ id: 'zeptomail', name: 'ZeptoMail', fetchImpl, capabilities: [PROVIDER_CAPABILITIES.API, PROVIDER_CAPABILITIES.TRANSACTIONAL, PROVIDER_CAPABILITIES.HTML, PROVIDER_CAPABILITIES.TEXT, PROVIDER_CAPABILITIES.CUSTOM_DOMAIN] });
    this.#apiKey = String(apiKey || '').replace(/^Zoho-enczapikey\s+/i, ''); this.#fromAddress = String(fromAddress || ''); this.#fromName = String(fromName || 'AdmissionSky');
  }
  async verifyConfiguration() { return Object.freeze({ configured: Boolean(this.#apiKey && this.#fromAddress), missing: [!this.#apiKey && 'apiKey', !this.#fromAddress && 'fromAddress'].filter(Boolean) }); }
  sendEmail(message, context = {}) {
    return this.sendHttp({
      url: 'https://api.zeptomail.com/v1.1/email', signal: context.signal, requestId: context.requestId,
      headers: { 'Content-Type': 'application/json', Authorization: `Zoho-enczapikey ${this.#apiKey}` },
      body: { from: { address: this.#fromAddress, name: this.#fromName }, to: [{ email_address: { address: message.recipient } }], subject: message.subject, htmlbody: message.html, textbody: message.text, track_clicks: false, track_opens: false, client_reference: context.requestId },
      mapResponse: data => ({ providerMessageId: data?.data?.[0]?.message_id || data?.request_id })
    });
  }
}
