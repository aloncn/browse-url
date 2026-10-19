/**
 * 共享会话：驱动系统 Chrome（channel: 'chrome'）+ 持久化用户目录
 * 登录态（cookie/localStorage）保存在 ~/.browser-profiles/<profile>，跨次复用。
 */
import { chromium } from 'playwright-core'
import os from 'node:os'
import path from 'node:path'

export const PROFILE_ROOT = path.join(os.homedir(), '.browser-profiles')
export const SHOT_DIR = path.join(PROFILE_ROOT, 'shots')

/**
 * @param {{ headed?: boolean, profile?: string, width?: number, height?: number }} opts
 */
export async function openSession(opts = {}) {
  const {
    headed = false,
    profile = 'default',
    width = 1440,
    height = 900
  } = opts

  const userDataDir = path.join(PROFILE_ROOT, profile)
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: !headed,
    viewport: { width, height },
    acceptDownloads: true,
    locale: 'zh-CN'
  })
  ctx.setDefaultTimeout(20000)
  return ctx
}

/** 收集页面运行时问题：console 报错 / 未捕获异常 / 失败请求 / 4xx-5xx 响应 */
export function attachDiagnostics(page, sink) {
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) {
      sink.push({ kind: 'console.' + msg.type(), text: msg.text().slice(0, 500) })
    }
  })
  page.on('pageerror', (err) => sink.push({ kind: 'pageerror', text: String(err).slice(0, 500) }))
  page.on('requestfailed', (req) =>
    sink.push({
      kind: 'requestfailed',
      text: `${req.method()} ${req.url()} — ${req.failure()?.errorText || ''}`.slice(0, 500)
    })
  )
  page.on('response', (res) => {
    if (res.status() >= 400) {
      sink.push({ kind: `http.${res.status()}`, text: `${res.request().method()} ${res.url()}`.slice(0, 500) })
    }
  })
  return sink
}

/** 打开页面：domcontentloaded + 可选等待选择器 + 短暂稳定期 */
export async function gotoPage(ctx, url, { waitSelector, settle = 800 } = {}) {
  const page = ctx.pages()[0] || (await ctx.newPage())
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  if (waitSelector) {
    await page.waitForSelector(waitSelector, { timeout: 20000 }).catch(() => {})
  }
  await page.waitForTimeout(settle)
  return page
}
