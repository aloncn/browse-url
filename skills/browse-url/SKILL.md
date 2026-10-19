---
name: browse-url
description: Open web pages in the real Chrome and collect evidence — screenshots, visible text, links, console errors, failed requests, 4xx/5xx responses, clicks, form fills, JS evaluation — with a persistent login profile. Use when you must see how a page actually renders, verify a front end, capture browser-side errors, or reach a page that requires being logged in. For plain public text, web_fetch is cheaper.
whenToUse: The user asks to open/inspect/verify an http(s) URL, walk through a front-end, capture a screenshot as evidence, reproduce a browser-only bug, drive a form, or access a site behind a login. Do not trigger for reading public docs or API bodies.
---

# Browser access (browse-url)

`browse` drives your **installed Chrome** through Playwright (`channel: chrome`, no browser
download). Login state persists in `~/.browser-profiles/<profile>`, so one manual login keeps
working across runs. Headless by default, viewport 1440×900, default timeout 20s.

Every command prints JSON: `{ ok, url, ..., diagnostics }`. `diagnostics` already contains
console errors/warnings, uncaught exceptions (`pageerror`), failed requests
(`requestfailed`) and any 4xx/5xx response — **check it first** when debugging a front end.

## Three commands cover most needs

```bash
browse shot    "<url>" out.png [--full] [--wait "<css>"]     # screenshot as evidence
browse text    "<url>" [--selector "<css>"] [--max 20000]    # visible text
browse console "<url>" [--seconds 5]                         # console + network problems only
```

Other commands:

| Command | Purpose |
|---|---|
| `browse open <url>` | open and return the title (`--headed` to log in by hand) |
| `browse links <url> [--max 100]` | list links |
| `browse click <url> <selector> [--shot out.png] [--wait <sel>]` | click |
| `browse fill <url> <selector> <value> [--submit <sel>]` | fill (optionally submit) |
| `browse eval <url> "<js expression>"` | evaluate JS in the page |
| `browse state [out.json]` | export a storage-state backup |

Common flags: `--profile <name>` (default `default`), `--headed`, `--width N`, `--height N`,
`--wait "<css>"` (wait for a selector), `--settle <ms>` (extra settle time, default 800).

## Multi-step flows: write a task script

```js
// task.mjs
export default async ({ page, shotPath, flags }) => {
  const base = flags.base || 'http://localhost:3000'
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)                    // SPAs need time; don't read too early
  await page.fill('input[name=user]', 'admin')
  await page.fill('input[name=pass]', 'secret')
  await page.click('button[type=submit]')
  await page.waitForTimeout(3000)
  const rows = await page.locator('.el-table__row').count()
  await page.screenshot({ path: shotPath('after-login.png'), fullPage: true })
  return { rows }                                    // wrapped as { ok: true, result }
}
```

```bash
browse run task.mjs --base http://localhost:3000
```

- Any custom `--xxx` flag is passed through to the script as `flags.xxx`
  (`--base` is **your** convention; built-in commands do not understand it)
- Script context: `{ ctx, page, flags, out, shotPath }`
- Prefer returning assertions over screenshots a human has to eyeball

## When NOT to use it

| Need | Use |
|---|---|
| Read public docs / API bodies | `web_fetch` (seconds, no browser) |
| Rendering, interaction, console/network errors, logged-in pages | **this CLI** |
| One-off exploration of unknown sites, proxies, anti-bot, large parallelism | a hosted browser agent (e.g. browser-use CLI/cloud) — this repo stays local and deterministic |

## Pitfalls (all learned the hard way)

1. **One profile cannot run concurrently** — the persistent user-data dir is locked.
   For parallel work use `--profile p1` / `--profile p2`.
2. **Hash routes (`#/path`) do not reload the page.** To drop in-memory auth state you must
   call `page.reload()`.
3. **Wait for SPAs** — `--settle 3000` or `waitForTimeout(≥2500)`, otherwise you misjudge
   "0 rows / blank page".
4. **"0 rows / no buttons" often means you were redirected to login** — check `page.url()`.
5. Screenshots default to `~/.browser-profiles/shots/`; pass a path to keep them with your project.
6. Sites requiring manual login (captcha / SMS / QR): `browse open "<url>" --headed`, log in once,
   the profile is reused afterwards.
7. Requires **Google Chrome** installed; `playwright-core` is the only dependency.

## Suggested workflow for a page audit

One script that (a) logs in, (b) visits a list of routes, (c) records for each route:
final URL, whether a "not found" / "no permission" marker appeared, row count, console errors
and non-2xx responses, (d) screenshots failures. Return a JSON array so the result can be
diffed between runs — that turns ad-hoc poking into a regression check.
