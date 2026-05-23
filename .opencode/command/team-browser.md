---
description: Browser perception/test pass with headed/manual support
agent: browser-tester
---

Run a browser perception/test pass for:

$ARGUMENTS

Rules:
- Prefer headed/manual CloakBrowser or Browser Bridge when login, CAPTCHA, 2FA, or strong anti-bot appears.
- Produce ScreenDigest, marked screenshot if useful, console/network status, and assertions.
- Record browser evidence.
- Do not bypass user confirmation for high-risk actions.
