import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.URL || 'http://127.0.0.1:9876';
const OUT = process.env.SHOT_DIR || 'C:/Users/Fengx/WorkBuddy/game/docs';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1440, height: 960 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function shot(name) {
  await sleep(450);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  截图 ->', `${name}.png`);
}

const phase = () => page.evaluate(() => window.App?.state?.room?.game?.phase);
const click = (act) => page.evaluate((a) => {
  const b = document.querySelector(`#room-shell [data-act="${a}"], #modal-root [data-act="${a}"]`);
  if (b && !b.disabled) { b.click(); return true; }
  return false;
}, act);

await page.goto(URL, { waitUntil: 'networkidle2' });
await page.click('[data-tab="guest"]');
await page.type('#form-guest input[name="name"]', '庄家');
await page.click('#form-guest button[type="submit"]');
await sleep(1200);
await page.click('#btn-create');
await sleep(600);
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

console.log('开始自动推进整庄（保留全部手动点击）');
let guard = 0;
let lastRound = 0;
while (guard < 220) {
  guard += 1;
  const p = await phase();
  if (!p) { await sleep(400); continue; }
  if (p === 'big_end') break;

  if (p === 'shuffle') await click('shuffle');
  else if (p === 'cut_dice') await click('rollCutDice');
  else if (p === 'cut_choice') { if (!(await click('cut'))) await click('skipCut'); }
  else if (p === 'bet') { /* 机器人自动押酒，等待 */ }
  else if (p === 'deal_dice') await click('rollDealDice');
  else if (p === 'reveal_dealer') await click('revealDealer');
  else if (p === 'reveal_players') { /* 机器人自动亮牌 */ }
  else if (p === 'settle') {
    const rn = await page.evaluate(() => window.App.state.room.game.roundNo);
    if (rn !== lastRound) {
      lastRound = rn;
      console.log(`  第 ${rn} 局结算完成`);
      if (rn === 1) await shot('20-round1-settle');
    }
    await click('nextRound');
  }
  await sleep(650);
}

const state = await page.evaluate(() => {
  const g = window.App.state.room.game;
  return { phase: g.phase, rounds: g.roundsPlayed, wall: g.wallLeft, bigRound: g.bigRound };
});
console.log('  大回合结束:', JSON.stringify(state));
await shot('21-big-end');

console.log('关闭统计面板');
await click('closeSummary');
await sleep(1600);
for (let i = 0; i < 8; i += 1) {
  const p = await phase();
  if (p === 'dealer_pick') break;
  await sleep(600);
  await click('closeSummary');
}
await shot('22-dealer-pick');

console.log('移庄给闲家');
const moved = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.modal .pick-item:not(.is-stay)')];
  if (items[0]) { items[0].click(); return true; }
  return false;
});
await sleep(2000);
const after = await page.evaluate(() => {
  const g = window.App.state.room.game;
  return { phase: g.phase, bigRound: g.bigRound, dealerSeat: g.dealerSeat, wall: g.wallLeft };
});
console.log('  移庄结果:', JSON.stringify(after), 'clicked=', moved);
await shot('23-new-biground');

await browser.close();
console.log('\n页面错误:', errors.length);
errors.slice(0, 8).forEach((e) => console.log('  !', e));
