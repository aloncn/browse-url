#!/usr/bin/env node
/**
 * 通用浏览器 CLI（供 AI 跨项目查看/操作页面）
 *
 * 用法示例：
 *   node browse.mjs open  <url> [--headed] [--wait <sel>]
 *   node browse.mjs shot  <url> [out.png] [--full] [--headed] [--wait <sel>]
 *   node browse.mjs text  <url> [--selector <sel>] [--max 20000]
 *   node browse.mjs links <url> [--max 100]
 *   node browse.mjs console <url> [--seconds 5]
 *   node browse.mjs click <url> <selector> [--shot out.png] [--wait <sel>]
 *   node browse.mjs fill  <url> <selector> <value> [--submit <sel>] [--shot out.png]
 *   node browse.mjs eval  <url> <js表达式>
 *   node browse.mjs state [out.json]          导出登录态备份
 *   node browse.mjs run   <task.mjs>          执行自定义任务脚本（default export 接收 ctx）
 *
 * 通用参数：--profile <名>（默认 default）、--headed、--width N、--height N
 */
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { openSession, attachDiagnostics, gotoPage, SHOT_DIR } from './session.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const positional = []
const flags = {}
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const key = a.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) flags[key] = true
    else {
      flags[key] = next
      i++
    }
  } else positional.push(a)
}

const out = (o) => console.log(JSON.stringify(o, null, 2))
const shotPath = (p) => {
  if (p) return path.resolve(p)
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  return path.join(SHOT_DIR, `shot-${Date.now()}.png`)
}

const sessionOpts = {
  headed: !!flags.headed,
  profile: typeof flags.profile === 'string' ? flags.profile : 'default',
  width: Number(flags.width || 1440),
  height: Number(flags.height || 900)
}

const ctx = await openSession(sessionOpts)
const diag = []
try {
  if (cmd === 'state') {
    const file = positional[0] || path.join(SHOT_DIR, 'storage-state.json')
    await ctx.storageState({ path: path.resolve(file) })
    out({ ok: true, storageState: path.resolve(file), profile: sessionOpts.profile })
  } else if (cmd === 'run') {
    const file = positional[0]
    if (!file) throw new Error('缺少任务脚本路径')
    const mod = await import(pathToFileURL(path.resolve(file)).href)
    const page = ctx.pages()[0] || (await ctx.newPage())
    attachDiagnostics(page, diag)
    const result = await mod.default({ ctx, page, flags, out, shotPath })
    out({ ok: true, result: result ?? null, diagnostics: diag.slice(0, 30) })
  } else {
    const url = positional[0]
    if (!url) throw new Error('缺少 URL')
    const page = ctx.pages()[0] || (await ctx.newPage())
    attachDiagnostics(page, diag)
    await gotoPage(ctx, url, { waitSelector: flags.wait, settle: Number(flags.settle || 800) })

    if (cmd === 'open') {
      out({ ok: true, url: page.url(), title: await page.title(), diagnostics: diag.slice(0, 30) })
    } else if (cmd === 'shot') {
      const file = shotPath(positional[1])
      await page.screenshot({ path: file, fullPage: !!flags.full })
      out({
        ok: true,
        url: page.url(),
        title: await page.title(),
        screenshot: file,
        diagnostics: diag.slice(0, 30)
      })
    } else if (cmd === 'text') {
      const max = Number(flags.max || 20000)
      const loc = flags.selector ? page.locator(flags.selector).first() : page.locator('body')
      const text = (await loc.innerText().catch(() => '')) || ''
      out({ ok: true, url: page.url(), length: text.length, text: text.slice(0, max) })
    } else if (cmd === 'links') {
      const max = Number(flags.max || 100)
      const links = await page.$$eval('a[href]', (as) =>
        as.map((a) => ({ text: (a.textContent || '').trim().slice(0, 60), href: a.href }))
      )
      const uniq = []
      const seen = new Set()
      for (const l of links) {
        if (seen.has(l.href)) continue
        seen.add(l.href)
        uniq.push(l)
        if (uniq.length >= max) break
      }
      out({ ok: true, url: page.url(), count: uniq.length, links: uniq })
    } else if (cmd === 'console') {
      await page.waitForTimeout(Number(flags.seconds || 5) * 1000)
      out({ ok: true, url: page.url(), diagnostics: diag.slice(0, 50) })
    } else if (cmd === 'click') {
      const sel = positional[1]
      if (!sel) throw new Error('缺少选择器')
      await page.click(sel)
      if (flags.wait) await page.waitForSelector(flags.wait).catch(() => {})
      await page.waitForTimeout(600)
      let screenshot
      if (flags.shot) {
        screenshot = shotPath(typeof flags.shot === 'string' ? flags.shot : undefined)
        await page.screenshot({ path: screenshot, fullPage: !!flags.full })
      }
      out({ ok: true, url: page.url(), screenshot, diagnostics: diag.slice(0, 30) })
    } else if (cmd === 'fill') {
      const [sel, value] = [positional[1], positional[2]]
      if (!sel || value === undefined) throw new Error('用法：fill <url> <selector> <value>')
      await page.fill(sel, value)
      if (flags.submit) {
        await page.click(flags.submit)
        await page.waitForTimeout(1200)
      }
      let screenshot
      if (flags.shot) {
        screenshot = shotPath(typeof flags.shot === 'string' ? flags.shot : undefined)
        await page.screenshot({ path: screenshot, fullPage: !!flags.full })
      }
      out({ ok: true, url: page.url(), screenshot, diagnostics: diag.slice(0, 30) })
    } else if (cmd === 'eval') {
      const js = positional[1]
      if (!js) throw new Error('用法：eval <url> <js表达式>')
      const value = await page.evaluate(js)
      out({ ok: true, url: page.url(), value })
    } else {
      throw new Error(`未知命令：${cmd}`)
    }
  }
} catch (err) {
  out({ ok: false, error: String(err && err.message ? err.message : err), diagnostics: diag.slice(0, 30) })
  process.exitCode = 1
} finally {
  await ctx.close()
}
