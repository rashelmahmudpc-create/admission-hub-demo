# 🧭 Worker শ্রেণীবিভাগ — ২৪-১০-২০২৬ (owner তালিকা অনুযায়ী)

owner-এর নির্দেশ: অ্যাপের সাথে সংযুক্তগুলো থাকবে; বাকি অচলগুলো বন্ধ/মুছে ফেলা হবে।

প্রমাণ: সরাসরি Cloudflare API (script list + secrets + GraphQL traffic) এবং repo source scan।

## ✅ থাকবে — 14টা

| Worker | কারণ | ১৪ দিনের request |
|---|---|---|
| `admission-gk` | মূল অ্যাপ backend — ৩৯,৮১২ request | 39,812 |
| `admission-gk-staging` | staging কপি, wrangler.staging.toml | 25 |
| `admission-auth` | লগইন-অথ, wrangler.auth.toml + deploy workflow | 5 |
| `admission-voice` | ভয়েস এজেন্ট, repo-তে ১৫ বার | 197 |
| `admission-notify` | notification, repo-তে ৩ বার | 1,227 |
| `sky-ai` | নিজস্ব wrangler + sky-ai-deploy workflow | 38 |
| `ah-public` | ১৭টা commit history, owner docs | 6 |
| `otp-tester` | otp ফ্লো, repo-তে ৪ বার | 53 |
| `agent-hq` | ১৭,২৭৯ request — AI hub | 17,279 |
| `agent-hq-bot` | ১৭,১০০ request — bot | 17,100 |
| `ah-admin` | owner-এর তালিকা | 19 |
| `mail-vault` | owner-এর তালিকা | 25 |
| `sky-control` | owner-এর তালিকা, ৩,২৭৯ request | 3,279 |
| `study-pal` | owner-এর তালিকা | 89 |

## 🗑️ বন্ধ/মুছার প্রার্থী — 8টা

| Worker | কারণ | HTTP | ১৪ দিনের request | secret |
|---|---|---|---|---|
| `email-worker` | 404, সোর্সে নেই, ০ secret | 404 | 0 | ? |
| `admission-hub-ai` | 404, সোর্সে নেই, ৪ request | 404 | 4 | ? |
| `admission-hub-ai-proxy` | 404, সোর্সে নেই, ১৯ request | 404 | 19 | ? |
| `admission-hub-vault` | 401, সোর্সে নেই, ৫০টা secret ধরে আছে | 401 | 6 | ? |
| `zayanday-vault` | 404, সোর্সে নেই, ৫৯টা secret ধরে আছে | 404 | 6 | ? |
| `gk-temp-fetcher` | তemporary fetcher, ১৪ request, সোর্সে নেই | 200 | 14 | ? |
| `ahai-watchman` | 404, সোর্সে নেই, ১১ request | 404 | 11 | ? |
| `sky-xfer` | 404, সোর্সে নেই, ৮ request | 404 | 8 | ? |

## 🛡️ ক্রম

1. প্রতিটার কোড backup (worker.js + wrangler সেটিংস)।
2. vault দুটোর গ্লোবাল কী + GitHub PAT rotate।
3. তারপর delete — মুছলে ফেরানো যায় না, তাই owner-এর স্পষ্ট হ্যাঁ লাগবে।

> কোনো Worker এখনো মোছা/বন্ধ করা হয়নি।
