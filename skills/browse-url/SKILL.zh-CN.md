---
name: browse-url
description: 用真实 Chrome 打开网页并取证（截图、正文、链接、console 报错、失败请求、点击、填表、执行 JS），登录态跨次复用。当任务需要"看页面实际渲染""验证前端是否正常""抓浏览器报错/网络失败""访问登录后才能打开的页面"时使用；只读公开文本时用 web_fetch 更省。
whenToUse: 用户要求打开/查看/验证某个 http(s) 地址、前端页面走查、截图取证、复现浏览器端问题、表单交互，或需要已登录态访问站点时触发；纯公开文档/接口正文读取不要触发本技能。
---

# 浏览器 URL 访问（browse-url）

`browse` 通过 Playwright 驱动**你已安装的 Chrome**（`channel: chrome`，不下载内核）。
登录态持久化在 `~/.browser-profiles/<profile>`，人工登录一次后续复用。
headless 默认，视口 1440×900，默认超时 20s。

输出统一为 JSON：`{ ok, url, ..., diagnostics }`。`diagnostics` 里已包含
console error/warning、未捕获异常（pageerror）、失败请求（requestfailed）、4xx/5xx 响应——
排查前端问题**先看它**。

## 三条命令覆盖大部分需求

```bash
browse shot    "<url>" out.png [--full] [--wait "<css>"]     # 截图取证
browse text    "<url>" [--selector "<css>"] [--max 20000]    # 取正文
browse console "<url>" [--seconds 5]                         # 只收集浏览器报错/失败请求
```

其余命令：

| 命令 | 用途 |
|---|---|
| `browse open <url>` | 打开并返回标题（配合 `--headed` 可人工登录） |
| `browse links <url> [--max 100]` | 导出页面链接 |
| `browse click <url> <selector> [--shot out.png] [--wait <sel>]` | 点击 |
| `browse fill <url> <selector> <value> [--submit <sel>]` | 填表（可提交） |
| `browse eval <url> "<js 表达式>"` | 在页面里求值 |
| `browse state [out.json]` | 导出登录态备份 |

通用参数：`--profile <名>`（默认 `default`）、`--headed`、`--width N`、`--height N`、
`--wait "<css>"`（等元素出现）、`--settle <ms>`（额外稳定等待，默认 800）。

## 多步流程：写任务脚本

```js
// task.mjs
export default async ({ page, shotPath, flags }) => {
  const base = flags.base || 'http://localhost:3000'
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)                    // SPA 渲染要等，别立刻取数
  await page.fill('input[name=user]', 'admin')
  await page.fill('input[name=pass]', 'secret')
  await page.click('button[type=submit]')
  await page.waitForTimeout(3000)
  const rows = await page.locator('.el-table__row').count()
  await page.screenshot({ path: shotPath('after-login.png'), fullPage: true })
  return { rows }                                    // 会包成 { ok: true, result }
}
```

```bash
browse run task.mjs --base http://localhost:3000
```

- 自定义 `--xxx` 会原样作为 `flags.xxx` 传给脚本（`--base` 属**脚本约定**，内置命令不识别）
- 脚本上下文：`{ ctx, page, flags, out, shotPath }`
- 建议：断言写成返回值，跑完对比 JSON，而不是靠截图人眼看

## 何时不要用它

| 需求 | 选什么 |
|---|---|
| 读公开文档 / 接口正文 | `web_fetch`（秒级、无需浏览器） |
| 看渲染、交互、console/网络报错、登录后页面 | **本工具** |
| 陌生站点一次性探索 / 需要代理、反检测、大规模并行 | 托管型浏览器 agent（如 browser-use CLI/云浏览器）——本仓库保持本地、确定性 |

## 已知坑（都踩过）

1. **同一 profile 不能并发**：持久化用户目录会被锁；并行请用 `--profile p1` / `--profile p2`
2. **hash 路由（`#/xxx`）切换不重载页面**：需要丢弃内存登录态时必须 `page.reload()`
3. **SPA 取数要等**：`--settle 3000` 或脚本里 `waitForTimeout(≥2500)`，否则会误判"0 行/空白"
4. **"0 行 / 无按钮"先怀疑被踢回登录页**：检查 `page.url()`
5. 截图默认落 `~/.browser-profiles/shots/`；要归档就显式传路径
6. 需要人工登录（验证码/扫码/短信）：`browse open "<url>" --headed` 手动登一次，之后自动复用
7. 依赖**系统 Chrome**；唯一依赖是 `playwright-core`

## 页面走查脚本的建议形态

一个脚本完成：① 登录 → ② 遍历路由清单 → ③ 逐条记录：最终 URL、"页面不存在/无权限"标记、
表格行数、console 报错、非 2xx 响应 → ④ 失败页截图。返回 JSON 数组，便于两次运行对比——
把"临时点一点"变成**可回归**的检查。
