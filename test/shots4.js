import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.URL || 'http://127.0.0.1:9876';
const OUT = process.env.SHOT_DIR || 'C:/Users/Fengx/WorkBuddy/game/docs';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox'],
  defaultViewport: { width: 1440, height: 960 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const shot = async (name) => {
  await sleep(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  截图 ->', `${name}.png`);
};
const click = (act) => page.evaluate((a) => {
  const b = document.querySelector(`#room-shell [data-act="${a}"], #modal-root [data-act="${a}"]`);
  if (b && !b.disabled) { b.click(); return true; } return false;
}, act);
const phase = () => page.evaluate(() => window.App?.state?.room?.game?.phase);

/* ---------- 1. 首页 ---------- */
await page.goto(URL, { waitUntil: 'networkidle2' });
await sleep(900);
console.log('1) 首页');
await shot('40-home');

/* ---------- 2. 注册并开桌 ---------- */
const uname = `mj${Date.now().toString().slice(-6)}`;
await page.click('[data-tab="register"]');
await page.type('#form-register input[name="username"]', uname);
await page.type('#form-register input[name="displayName"]', '阿饼');
await page.type('#form-register input[name="password"]', '123456');
await page.click('#form-register button[type="submit"]');
await sleep(1600);

await page.click('#btn-create');
await sleep(700);
await page.evaluate(() => {
  const r = document.querySelector('#config-block input[type=range]');
  if (r) { r.value = 4; r.dispatchEvent(new Event('input', { bubbles: true })); }
  document.querySelector('.modal [data-act="create"]')?.click();
});
await sleep(1500);
await page.evaluate(() => document.querySelector('[data-act="fillBots"]')?.click());
await sleep(1200);
await page.evaluate(() => document.querySelector('[data-act="ready"]')?.click());
await sleep(1800);

/* ---------- 3. 打两局 ---------- */
for (let round = 0; round < 2; round += 1) {
  for (let i = 0; i < 60; i += 1) {
    const p = await phase();
    if (p === 'settle') break;
    if (p === 'big_end') break;
    if (p === 'shuffle') await click('shuffle');
    else if (p === 'cut_dice') await click('rollCutDice');
    else if (p === 'cut_choice') { if (!(await click('cut'))) await click('skipCut'); }
    else if (p === 'deal_dice') await click('rollDealDice');
    else if (p === 'reveal_dealer') await click('revealDealer');
    await sleep(600);
  }
  // 等机器人亮牌
  for (let i = 0; i < 20; i += 1) {
    const p = await phase();
    if (p === 'settle') break;
    await sleep(700);
  }
  // 等动画队列播完再截图
  await sleep(3000);
  await page.evaluate(() => document.querySelector('.modal [data-close]')?.click());
  await sleep(700);
  if (round === 0) {
    const info = await page.evaluate(() => window.App.state.room.myHandInfo);
    console.log('   我的手牌摘要:', JSON.stringify(info));
    await shot('41-hand-info');
  }
  // 开始下一局
  await click('nextRound');
  await sleep(1200);
}

/* ---------- 4. 历史回放 ---------- */
console.log('2) 历史回放');
await page.evaluate(() => document.querySelector('[data-act="openHistory"]')?.click());
await sleep(900);
const histInfo = await page.evaluate(() => {
  const rounds = document.querySelectorAll('.hist-round');
  const open = document.querySelector('.hist-round[open]');
  return {
    rounds: rounds.length,
    rows: open ? open.querySelectorAll('tbody tr').length : 0,
    header: open ? open.querySelector('summary')?.innerText.replace(/\s+/g, ' ') : '',
  };
});
console.log('   回放局数:', histInfo.rounds, '| 展开局行数:', histInfo.rows);
console.log('   概要:', histInfo.header);
await shot('42-history');

/* ---------- 5. 我的战绩 ---------- */
console.log('3) 我的战绩');
await page.evaluate(() => document.querySelector('.modal [data-close]')?.click());
await sleep(400);
await page.evaluate(() => document.getElementById('btn-my-stats')?.click());
await sleep(1200);
const statInfo = await page.evaluate(() => {
  const card = document.querySelector('.stat-card');
  return card ? card.innerText.replace(/\s+/g, ' ') : '（无）';
});
console.log('   战绩卡:', statInfo);
await shot('43-my-stats');

/* ---------- 6. 管理后台 ---------- */
console.log('4) 管理后台');
await page.evaluate(() => document.querySelector('.modal [data-close]')?.click());
await sleep(300);
await page.evaluate(() => window.App.logout());
await sleep(1200);
await page.evaluate(() => document.querySelector('[data-tab="login"]')?.click());
await page.type('#form-login input[name="username"]', 'admin');
await page.type('#form-login input[name="password"]', 'admin');
await page.click('#form-login button[type="submit"]');
await sleep(1500);
await page.evaluate(() => document.getElementById('btn-goto-admin')?.click());
await sleep(1200);
const adminRows = await page.evaluate(() =>
  [...document.querySelectorAll('#admin-tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
console.log('   后台行:');
adminRows.forEach((r) => console.log('     ', r));
await shot('44-admin-stats');

await browser.close();
console.log('\n页面错误:', errors.length);
errors.slice(0, 8).forEach((e) => console.log('  !', e));
