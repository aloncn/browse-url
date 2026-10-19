# browse-url

**Let your AI coding agent drive your real Chrome — with your logins — and come back with evidence.**

A ~200-line CLI plus a ready-made AI skill. Your agent runs one command and gets a screenshot,
the visible text, console errors, failed requests and any 4xx/5xx — as JSON.

```bash
browse console "http://localhost:3000/dashboard" --seconds 5
browse shot    "http://localhost:3000/orders" orders.png --full
```

```json
{
  "ok": true,
  "url": "http://localhost:3000/dashboard",
  "diagnostics": [
    { "kind": "console.error", "text": "Cannot read properties of undefined (reading 'rows')" },
    { "kind": "http.404", "text": "GET http://localhost:3000/api/stats" }
  ]
}
```

---

## Why

Coding agents are blind to rendered pages. They can `curl` HTML, but they cannot see:

- whether the page **actually renders** (blank screen, error toast, layout break)
- **console errors** and **failed requests** that only appear in a browser
- pages that require **being logged in**
- what happens after a click, a form submit, or on a hash-route navigation

Agent-loop browsers (LLM decides every step) solve this, but they cost **per task** and take
**minutes per task**. For your *own* product — where you know the selectors — a deterministic
script is faster, cheaper and reproducible. That is what this repo is:

| | this CLI | agent-loop browser (e.g. browser-use) |
|---|---|---|
| Who decides | your agent writes a script | the library calls an LLM each step |
| Cost per run | ~0 (no extra model calls) | $0.05–$8 per task in vendor benchmarks |
| Latency | seconds | minutes |
| Reproducible / CI-able | yes | no (path varies) |
| Unknown third-party sites | you write selectors | works out of the box |

Use this for **regression checks and debugging your own app**; reach for an agent-loop browser
only for one-off exploration of sites you do not control.

## Requirements

- **Google Chrome** installed (this CLI drives your Chrome; no browser download)
- Node.js 18+
- macOS / Linux (paths assume a POSIX shell)

## Install

### 1) Install the skill (any agent, one command)

```bash
npx skills add aloncn/browse-url -g
```

`npx skills` (the open agent-skills CLI, 70+ agents: Claude Code, Codex, Cursor, OpenCode, …)
clones this repo, finds `skills/browse-url/SKILL.md`, and links it into your agent's global
skills directory. Pick agents explicitly if you prefer:

```bash
npx skills add aloncn/browse-url -g -a claude-code -a codex -y
```

### 2) Get the `browse` command

**Option A — install once so `browse` is on your PATH (recommended):**

```bash
git clone --depth 1 https://github.com/aloncn/browse-url.git
cd browse-url && ./install.sh
```

`install.sh` installs the single dependency (`playwright-core`), symlinks
`cli/browse.mjs` → `~/.local/bin/browse`, and (re)installs the skill locally.

**Option B — no clone, run straight from GitHub:**

```bash
npx -y github:aloncn/browse-url text "https://example.com"
```

This works, but the first run makes npm clone the repo and install dependencies, so it can be
slow (or stall) on networks where npm→GitHub git traffic is throttled. Prefer Option A there.

Either way you need **Google Chrome** installed — this tool drives your Chrome, it does not
download a browser.

Smoke test:

```bash
browse text "data:text/html,<h1>hello</h1>"
```

### Which skill language gets installed?

`npx skills add` copies the whole skill directory, so both files land in
`~/.agents/skills/browse-url/`; agents read `SKILL.md`. The default `SKILL.md` is English.
To use the Chinese variant:

```bash
cp ~/.agents/skills/browse-url/SKILL.zh-CN.md ~/.agents/skills/browse-url/SKILL.md
```

### Targeting one agent instead of all

Without `-a`, the CLI links the skill into every agent it detects (70+). To keep it tight:

```bash
npx skills add aloncn/browse-url -g -a claude-code -y
```

## Commands

```bash
browse shot    <url> [out.png] [--full] [--wait <css>]      # screenshot
browse text    <url> [--selector <css>] [--max 20000]       # visible text
browse console <url> [--seconds 5]                          # console + network problems
browse open    <url>                                        # open, return title
browse links   <url> [--max 100]                            # links
browse click   <url> <selector> [--shot out.png] [--wait <sel>]
browse fill    <url> <selector> <value> [--submit <sel>]
browse eval    <url> "<js expression>"
browse state   [out.json]                                   # storage-state backup
browse run     <task.mjs> [--anything]                      # custom flow
```

Common flags: `--profile <name>` (default `default`), `--headed`, `--width`, `--height`,
`--wait "<css>"`, `--settle <ms>`.

Every command prints JSON on stdout. `diagnostics` collects `console.error`, `console.warning`,
`pageerror`, `requestfailed` and any response with status ≥ 400.

## Multi-step flows

```js
// task.mjs
export default async ({ page, shotPath, flags }) => {
  const base = flags.base || 'http://localhost:3000'
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)              // SPAs need time
  await page.fill('input[name=user]', process.env.APP_USER)
  await page.fill('input[name=pass]', process.env.APP_PASS)
  await page.click('button[type=submit]')
  await page.waitForTimeout(3000)
  const rows = await page.locator('.el-table__row').count()
  await page.screenshot({ path: shotPath('after-login.png'), fullPage: true })
  return { rows }
}
```

```bash
browse run task.mjs --base http://localhost:3000
```

Custom `--xxx` flags arrive as `flags.xxx`. The script context is `{ ctx, page, flags, out, shotPath }`.
Return values are wrapped as `{ ok: true, result }`.

### A page-audit pattern that pays off

One script that logs in once, walks a route list, and for each route records: final URL,
whether a "not found / no permission" marker appeared, row count, console errors, non-2xx
responses — plus a screenshot for failures. Return a JSON array and diff it between runs.
Ad-hoc poking becomes a regression check.

## Login state

Persistent profile at `~/.browser-profiles/<profile>` (cookies + localStorage).

- Sites with **captcha / SMS / QR** login: `browse open "<url>" --headed`, log in by hand once.
  Every later run reuses the profile.
- One profile **cannot** be used concurrently — the user-data dir is locked. Use
  `--profile p1`, `--profile p2` for parallel jobs.
- If your app enforces single-session per account, an API token minted in a script will kick
  your browser session (and vice versa). Do API checks first, then log in for UI checks.

## Pitfalls this CLI cannot hide

1. Hash routes (`#/path`) do **not** reload the page — call `page.reload()` when you need to
   drop in-memory auth state.
2. Wait for SPAs (`--settle 3000` or `waitForTimeout(≥2500)`), or you will misread "0 rows".
3. "0 rows / no buttons" frequently means you were redirected to the login page — check `page.url()`.
4. Screenshots default to `~/.browser-profiles/shots/`; pass a path to keep them with your project.

## The AI skill

`skills/browse-url/SKILL.md` (English) and `SKILL.zh-CN.md` (Chinese) describe when an agent
should reach for the browser instead of `web_fetch`, the exact commands, and the pitfalls above.
Skill-aware agents pick it up automatically after `npx skills add aloncn/browse-url -g`
(or after `install.sh`, which also drops it into `~/.agents/skills/browse-url/`).

For agents without a skill mechanism, paste a short version into their instructions file
(`AGENTS.md`, `GEMINI.md`, …):

```markdown
## Browser (URL access)
When a task needs the rendered page, a screenshot, console errors or a logged-in session, use:
  browse shot "<url>" out.png --full
  browse console "<url>" --seconds 5
For multi-step flows write task.mjs and run: browse run task.mjs --base <base>
For plain public text, prefer web_fetch.
```

## 中文说明

`browse-url` 让 AI 编码助手**驱动你本机的 Chrome**（带你的登录态），把页面证据取回来：
截图、正文、console 报错、失败请求、4xx/5xx，全部以 JSON 返回。

```bash
./install.sh                                  # 装依赖 + 链接 browse + 安装技能
browse shot "<url>" out.png --full             # 截图
browse console "<url>" --seconds 5             # 只看报错
browse run task.mjs --base http://localhost:3000   # 多步流程
```

适合：自家产品的**回归走查与问题复现**（确定性、零额外模型成本、可进 CI）。
不适合：陌生站点的开放式探索（那种场景用 agent 型浏览器更合适）。

登录态在 `~/.browser-profiles/<profile>`，同一 profile 不能并发；验证码/扫码登录请先
`browse open "<url>" --headed` 手动登一次。

## License

MIT — see [LICENSE](LICENSE).
