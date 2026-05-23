# P2.5 Browser Perception + Headed CloakBrowser

P2.5 upgrades the browser layer from simple evidence capture to a text-first browser perception loop.

## Goals

- Run CloakBrowser **headed by default** so the user can solve login/CAPTCHA/challenge/manual steps.
- Use a persistent profile by default: `.opencode/team/browser/profile`.
- Convert noisy page state into a compact `ScreenDigest` for text-only models.
- Let models act by element id (`e1`, `e2`) instead of raw selectors or coordinates.
- Save every observation/action as evidence.

## Browser perception pipeline

```text
CloakBrowser page
  -> raw state      current-raw.json
  -> reduced state  current-reduced.json
  -> ScreenDigest   current-digest.json
  -> marked screenshot with element ids
  -> act_by_id
  -> new evidence
```

## Manual intervention

Use `--manual` or the MCP `manual: true` argument when a page needs the user.

The headed browser will display an overlay:

```text
OpenCode Team: manual browser step
[ Continue agent ]
```

The user completes the browser step, then clicks **Continue agent**. The runner then records a screenshot, ScreenDigest, console/network health, and evidence.

## CLI examples

```bash
./opencode-browser doctor

# Compact page understanding for text-only models
./opencode-browser digest https://example.com --mark

# Let the user handle login/challenge, then capture digest
./opencode-browser manual https://example.com/login --manual-timeout-ms 900000 --mark

# Observe full text/reduced/digest artifacts
./opencode-browser observe http://localhost:3000 --mode all --mark

# Act by element id from latest current-reduced.json
./opencode-browser act http://localhost:3000 --target e3 --action click --text Saved
./opencode-browser act http://localhost:3000 --target e1 --action type --value 'test@example.com'
```

## MCP tools

- `cloakbrowser_visit`
- `cloakbrowser_snapshot`
- `cloakbrowser_observe`
- `cloakbrowser_digest`
- `cloakbrowser_act_by_id`
- `cloakbrowser_manual`
- `cloakbrowser_interact`
- `cloakbrowser_doctor`

## Agent roles

- `browser-perception`: compresses observations into human-visible summaries.
- `browser-actor`: performs safe actions by element id.
- `browser-tester`: verifies web apps and records evidence.
- `visual-reviewer`: checks screenshot/layout cases when text state is insufficient.

## Notes

P2.5 does not implement a native Chrome extension bridge yet. It gives the same core idea in a simpler form: a headed browser, persistent profile, page-state extraction, ScreenDigest, marked screenshots, and safe id-based actions. A future P2.6 can add a native messaging bridge inspired by codex-chrome for controlling the user's existing Chrome profile.
