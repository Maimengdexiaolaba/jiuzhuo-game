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
  args: ['--no-sandbox', '--window-size=1440,960', '--force-device-scale-factor=1'],
  defaultViewport: { width: 1440, height: 960 },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

async function shot(name) {
  await sleep(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  截图 ->', `${name}.png`);
}

console.log('1) 登录页');
await page.goto(URL, { waitUntil: 'networkidle2' });
await shot('01-auth');

console.log('2) 游客进入');
await page.click('[data-tab="guest"]');
await page.type('#form-guest input[name="name"]', '阿甲');
await page.click('#form-guest button[type="submit"]');
await sleep(1200);
await shot('02-lobby-empty');

console.log('3) 创建房间弹窗');
await page.click('#btn-create');
await sleep(600);
await shot('03-create-modal');

console.log('4) 创建 4 人房间');
await page.evaluate(() => {
  const r = document.querySelector('#config-block input[type=range]');
  if (r) { r.value = 4; r.dispatchEvent(new Event('input', { bubbles: true })); }
});
await sleep(300);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.modal [data-act="create"]')][0];
  b?.click();
});
await sleep(1500);
await shot('04-room-waiting');

console.log('5) 加机器人并准备');
await page.evaluate(() => document.querySelector('[data-act="fillBots"]')?.click());
await sleep(1200);
await page.evaluate(() => document.querySelector('[data-act="ready"]')?.click());
await sleep(2000);
await shot('05-game-start');

console.log('6) 洗牌动画');
await page.evaluate(() => document.querySelector('[data-act="shuffle"]')?.click());
await sleep(700);
await shot('06-shuffle-anim');
await sleep(2200);

console.log('7) 掷骰');
await page.evaluate(() => document.querySelector('[data-act="rollCutDice"]')?.click());
await sleep(800);
await shot('07-dice-anim');
await sleep(2600);
await shot('08-after-cut-dice');

console.log('8) 推进到押酒');
for (let i = 0; i < 12; i += 1) {
  const phase = await page.evaluate(() => window.App?.state?.room?.game?.phase);
  if (phase === 'bet') break;
  await page.evaluate(() => {
    const cut = document.querySelector('[data-act="cut"]');
    const skip = document.querySelector('[data-act="skipCut"]');
    if (cut) cut.click();
    else if (skip) skip.click();
  });
  await sleep(900);
}
await shot('09-bet-phase');

console.log('9) 押酒并推进到发牌');
await page.evaluate(() => {
  const b = document.querySelectorAll('[data-act="bet"]');
  (b[1] || b[0])?.click();
});
await sleep(1500);
for (let i = 0; i < 8; i += 1) {
  const phase = await page.evaluate(() => window.App?.state?.room?.game?.phase);
  if (phase === 'deal_dice') break;
  await sleep(900);
}
await shot('10-deal-dice');

console.log('10) 掷骰发牌');
await page.evaluate(() => document.querySelector('[data-act="rollDealDice"]')?.click());
await sleep(900);
await shot('11-deal-anim');
await sleep(3000);
await shot('12-dealt');

console.log('11) 亮牌');
await page.evaluate(() => document.querySelector('[data-act="revealDealer"]')?.click());
await sleep(1200);
await shot('13-dealer-revealed');

for (let i = 0; i < 10; i += 1) {
  const phase = await page.evaluate(() => window.App?.state?.room?.game?.phase);
  if (phase === 'settle') break;
  await sleep(1200);
}
await sleep(1200);
await shot('14-settle');

console.log('12) 结算弹窗内容');
const settleInfo = await page.evaluate(() => {
  const rows = document.querySelectorAll('.settle-table tbody tr');
  return {
    rowCount: rows.length,
    hero: document.querySelector('.settle-hero')?.innerText.replace(/\n+/g, ' | '),
    firstRow: rows[0]?.innerText.replace(/\n+/g, ' | '),
  };
});
console.log('   结算行数:', settleInfo.rowCount);
console.log('   汇总:', settleInfo.hero);
console.log('   首行:', settleInfo.firstRow);

console.log('13) 刷新页面后恢复座位');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.modal [data-close], .modal .icon-btn')][0];
  b?.click();
});
await sleep(400);
await page.reload({ waitUntil: 'networkidle2' });
await sleep(2000);
const afterReload = await page.evaluate(() => ({
  view: window.App?.state?.view,
  roomId: window.App?.state?.room?.id,
  mySeat: window.App?.state?.room?.mySeat,
  guest: window.App?.state?.user?.isGuest,
}));
console.log('   刷新后:', JSON.stringify(afterReload));
await shot('16-after-reload');

console.log('14) 移动端视图');
await page.setViewport({ width: 420, height: 900 });
await sleep(900);
await shot('17-mobile');

await browser.close();

console.log('\n页面错误数量:', errors.length);
errors.slice(0, 12).forEach((e) => console.log('  !', e));
process.exit(0);
