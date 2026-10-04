// QA Cat. 10 — POS + KDS critical flow, end to end, Arabic RTL, against a REAL QA site.
// QA SERVER ONLY: this places real orders and payments on QA_URL.
//
// Flow per viewport: login -> open shift (if needed) -> pick table -> add items (incl. long Arabic
// name) -> send to kitchen -> KDS shows the ticket -> payment (cash) -> settled -> table free.
// Checks: console errors, failed /api calls, RTL, horizontal overflow, empty search state,
// slow-network payment (exactly one settlement).
//
// Run:
//   QA_URL=http://qa1.localhost:8000 QA_WORLD=qa/evidence/world_qa1.localhost.json \
//   node qa/e2e/pos_critical_flow.cjs
// Uses the same Playwright build as scripts/test_urypos_qa.cjs (PLAYWRIGHT_MODULE / CHROMIUM_PATH).
//
// The POS has no data-testid attributes; selectors use the Arabic labels from pos/src/i18n/locales/ar.json.
// Never executed yet (written on the production host) — first run is a selector shakedown.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/home/frappe/.cache/ms-playwright-go/1.50.1/package');

const BASE = process.env.QA_URL || 'http://qa1.localhost:8000';
const host = new URL(BASE).hostname;
const ALLOWED = new Set(['qa1.localhost', 'qa2.localhost', ...(process.env.QA_ALLOWED_HOSTS || '').split(',').filter(Boolean)]);
for (const prod of ['portal.smartchoice-iq.com', 'demo.smarterp.com', 'demo.smart_chat.com']) {
  if (fs.existsSync(path.join(process.env.QA_BENCH || `${process.env.HOME}/frappe-bench`, 'sites', prod))) {
    console.error(`REFUSED: this bench hosts production site ${prod}`); process.exit(2);
  }
}
if (!ALLOWED.has(host)) { console.error(`REFUSED: ${BASE} is not a QA host`); process.exit(2); }

const worldText = fs.readFileSync(process.env.QA_WORLD || 'qa/evidence/world_qa1.localhost.json', 'utf8');
const WORLD = JSON.parse(worldText.slice(worldText.indexOf('{')))['A'];
const EVID = path.join(__dirname, '..', 'evidence', 'cat10');
fs.mkdirSync(EVID, { recursive: true });

const L = {
  openShift: /فتح الشفت/, confirmZero: /تأكيد وفتح/, continue: /المتابعة للكاشير/,
  addToOrder: /إضافة إلى الطلب/, send: /إرسال إلى المطبخ|^إرسال$|حفظ/, payment: /^الدفع$/,
  payBtn: /^استلام/, settled: /تم الحساب/, done: /^تم$/, searchMenu: /ابحث بأصناف المنيو|ابحث بالمنيو/,
};
const VIEWPORTS = [
  { tag: '1024x768', viewport: { width: 1024, height: 768 }, hasTouch: false },
  { tag: 'tablet-1280x800-touch', viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false },
];

async function clickByRole(page, re, opts = {}) {
  const el = page.getByRole('button', { name: re }).first();
  await el.waitFor({ timeout: opts.timeout || 15000 });
  await el.click();
}

async function apiCall(page, method, params) {
  return page.evaluate(async ([m, p]) => {
    const r = await fetch(`/api/method/${m}?` + new URLSearchParams(p), { headers: { Accept: 'application/json' } });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [method, params]);
}

async function run(browser, vp, results) {
  const ctx = await browser.newContext({ viewport: vp.viewport, hasTouch: vp.hasTouch, locale: 'ar-IQ', timezoneId: 'Asia/Baghdad' });
  const page = await ctx.newPage();
  const consoleErrors = [], failed = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  const shot = (n) => page.screenshot({ path: path.join(EVID, `${vp.tag}-${n}.png`), fullPage: true });
  const step = async (name, fn) => {
    try { await fn(); results.push({ vp: vp.tag, step: name, pass: true }); }
    catch (e) { results.push({ vp: vp.tag, step: name, pass: false, error: String(e).slice(0, 300) }); await shot(`FAIL-${name}`); throw e; }
  };

  try {
    await step('login', async () => {
      await page.addInitScript(() => localStorage.setItem('ury_language', 'ar'));
      await page.goto(`${BASE}/login`);
      await page.fill('#login_email', WORLD.users.cashier);
      await page.fill('#login_password', WORLD.password);
      await page.click('.btn-login');
      await page.waitForURL(/\/pos/, { timeout: 30000 });
    });

    await step('rtl', async () => {
      const dir = await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
      assert.equal(dir, 'rtl');
    });

    await step('open-shift', async () => {
      if (await page.getByRole('button', { name: L.openShift }).count()) {
        const amount = page.locator('input[type="number"]').first();
        if (await amount.count()) await amount.fill('50000');
        await clickByRole(page, L.openShift);
        if (await page.getByRole('button', { name: L.confirmZero }).count()) await clickByRole(page, L.confirmZero);
      }
      if (await page.getByRole('button', { name: L.continue }).count()) await clickByRole(page, L.continue);
      await shot('01-after-shift');
    });

    const table = WORLD.tables[vp.tag.startsWith('1024') ? 0 : 1];
    await step('pick-table', async () => {
      await page.getByText(table, { exact: false }).first().click({ timeout: 20000 });
    });

    await step('add-items', async () => {
      for (const item of ['_QA Burger', '_QA Tea']) {
        await page.getByText(item, { exact: false }).first().click({ timeout: 15000 });
        if (await page.getByRole('button', { name: L.addToOrder }).count()) await clickByRole(page, L.addToOrder);
      }
      await shot('02-cart');
    });

    await step('no-horizontal-overflow', async () => {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 1, `page scrolls horizontally by ${over}px`);
    });

    let invoice = null;
    await step('send-to-kitchen', async () => {
      const resp = page.waitForResponse((r) => r.url().includes('ury_order.sync_order') && r.request().method() === 'POST', { timeout: 30000 });
      await clickByRole(page, L.send);
      const r = await resp;
      assert.equal(r.status(), 200);
      invoice = (await r.json()).message.name;
    });

    await step('kds-shows-ticket', async () => {
      const kds = await ctx.newPage();
      await kds.goto(`${BASE}/mosaic`);
      await kds.getByText(table, { exact: false }).first().waitFor({ timeout: 20000 });
      await kds.screenshot({ path: path.join(EVID, `${vp.tag}-03-kds.png`), fullPage: true });
      await kds.close();
    });

    await step('pay-cash-slow-network', async () => {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 800, downloadThroughput: 50000, uploadThroughput: 25000 });
      await clickByRole(page, L.payment);
      const pay = page.getByRole('button', { name: L.payBtn }).first();
      await pay.waitFor({ timeout: 20000 });
      await pay.click();
      await pay.click({ force: true }).catch(() => {});   // impatient double tap on a slow link
      await page.getByText(L.settled).first().waitFor({ timeout: 60000 });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await shot('04-settled');
      const r = await apiCall(page, 'frappe.client.get', { doctype: 'POS Invoice', name: invoice });
      const pays = (r.body?.message?.payments || []).filter((p) => p.amount > 0);
      const paid = pays.reduce((s, p) => s + p.amount, 0);
      assert.equal(r.body.message.docstatus, 1, 'invoice not submitted');
      assert.equal(Math.round(paid - (r.body.message.change_amount || 0)), Math.round(r.body.message.rounded_total || r.body.message.grand_total), `paid ${paid}`);
      if (await page.getByRole('button', { name: L.done }).count()) await clickByRole(page, L.done);
    });

    await step('table-free-after-payment', async () => {
      const r = await apiCall(page, 'frappe.client.get_value', { doctype: 'URY Table', filters: JSON.stringify({ name: table }), fieldname: 'occupied' });
      assert.equal(r.body?.message?.occupied, 0);
    });

    await step('empty-search-state', async () => {
      const search = page.getByPlaceholder(L.searchMenu).first();
      if (await search.count()) {
        await search.fill('zzzz-لا-يوجد');
        await page.waitForTimeout(800);
        await shot('05-empty-search');
      }
    });
  } catch (_) { /* recorded by step() */ }

  results.push({ vp: vp.tag, step: 'console-errors', pass: consoleErrors.length === 0, error: consoleErrors.slice(0, 10) });
  results.push({ vp: vp.tag, step: 'failed-api-calls', pass: failed.length === 0, error: failed.slice(0, 10) });
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/home/frappe/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    headless: true, args: ['--no-sandbox'],
  });
  const results = [];
  try { for (const vp of VIEWPORTS) await run(browser, vp, results); }
  finally { await browser.close(); }
  fs.writeFileSync(path.join(EVID, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.vp} ${r.step}${r.pass ? '' : ' — ' + JSON.stringify(r.error)}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
})();
