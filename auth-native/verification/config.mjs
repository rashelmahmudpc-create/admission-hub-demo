import { VERIFICATION_CHANNELS, VERIFICATION_MODES } from './provider-contract.mjs';

const SLOT_DEFINITIONS = Object.freeze({
  'otp-a': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 10 }),
  'otp-b': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 20 }),
  'otp-c': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 30 }),
  'otp-d': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 35 }),
  'otp-e': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 37 }),
  whatsapp: Object.freeze({ channel: VERIFICATION_CHANNELS.WHATSAPP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 40 }),
  telegram: Object.freeze({ channel: VERIFICATION_CHANNELS.TELEGRAM, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 50 })
});

const int = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const ratio = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
};
const bool = value => value === true;
const cleanReason = value => String(value || '').replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 80);

const DEFAULT_POLICY = Object.freeze({
  codeTtlSeconds: 300,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  lockoutSeconds: 900,
  maxProviderRetries: 1,
  circuitFailureThreshold: 3,
  circuitCooldownSeconds: 300,
  lowQuotaRatio: 0.15
});

function safeJson(raw) {
  if (!raw) return {};
  const text = String(raw);
  if (text.length > 16_384) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function verificationConfig(raw) {
  const input = typeof raw === 'string' ? safeJson(raw) : (raw && typeof raw === 'object' ? raw : {});
  const policyInput = input.policy && typeof input.policy === 'object' ? input.policy : {};
  const policy = Object.freeze({
    codeTtlSeconds: int(policyInput.codeTtlSeconds, DEFAULT_POLICY.codeTtlSeconds, 60, 600),
    maxAttempts: int(policyInput.maxAttempts, DEFAULT_POLICY.maxAttempts, 1, 5),
    resendCooldownSeconds: int(policyInput.resendCooldownSeconds, DEFAULT_POLICY.resendCooldownSeconds, 30, 600),
    lockoutSeconds: int(policyInput.lockoutSeconds, DEFAULT_POLICY.lockoutSeconds, 60, 86_400),
    maxProviderRetries: int(policyInput.maxProviderRetries, DEFAULT_POLICY.maxProviderRetries, 0, 2),
    circuitFailureThreshold: int(policyInput.circuitFailureThreshold, DEFAULT_POLICY.circuitFailureThreshold, 1, 10),
    circuitCooldownSeconds: int(policyInput.circuitCooldownSeconds, DEFAULT_POLICY.circuitCooldownSeconds, 30, 3_600),
    lowQuotaRatio: ratio(policyInput.lowQuotaRatio, DEFAULT_POLICY.lowQuotaRatio)
  });
  const supplied = Array.isArray(input.providers) ? input.providers : [];
  const byId = new Map(supplied.map(row => [String(row?.id || ''), row]));
  const providers = Object.entries(SLOT_DEFINITIONS).map(([id, slot]) => {
    const row = byId.get(id) || {};
    return Object.freeze({
      id,
      channel: slot.channel,
      verificationMode: slot.verificationMode,
      enabled: bool(row.enabled),
      priority: int(row.priority, slot.priority, 1, 10_000),
      dailyQuota: int(row.dailyQuota, 0, 0, 10_000_000),
      timeoutMs: int(row.timeoutMs, 8_000, 1_000, 20_000),
      label: cleanReason(row.label) || id.toUpperCase()
    });
  }).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  return Object.freeze({
    enabled: bool(input.enabled),
    policy,
    providers: Object.freeze(providers)
  });
}

export const defaultVerificationConfig = () => verificationConfig({});
export const __verificationConfigTest = Object.freeze({ SLOT_DEFINITIONS, DEFAULT_POLICY, safeJson });
