# LATEST — App-style one-screen Welcome + premium action stack (v246)

**Updated:** 2026-09-14 (Asia/Dhaka) · Agent: **Arena Agent Mode**

## STATUS

- **IMPLEMENTED:** The first-entry Welcome now fills exactly one viewport on every device — verified at 320×568, 360×640, 375×667, 390×844, 393×852, 412×915, 430×932, 768×1024, 820×1180, 1024×768, 1280×800, 1440×900 and 1920×1080 with zero vertical or horizontal overflow. The four entry paths were rebuilt as one premium stack: uniform 56px pills, gradient Sign Up, soft-shadow Log In, circular colour-mark Google button and a plain underlined Guest link.
- **TESTED:** auth 62/62 · email 108/108 + 4/4 · native-auth 203/203 · browser audit ok with pageErrors 0 · 13/13 viewports fit · 53/53 release file asserts.
- **HARDENED:** the protected browser audit now fails the release if the Welcome page scrolls or any entry button drops below the 44px touch target.
- **DEPLOYED:** pending the publish run after merge.

## DETAIL

- `AGENT_RESUME/2026-09-14-fit-welcome-v246.md`
- History: v244 (premium scene rebuild) was reverted by owner review; v245 removed the 3D hero and kept the original design; v246 makes it a one-screen app view.
