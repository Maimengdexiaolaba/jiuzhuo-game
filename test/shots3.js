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

await page.goto(URL, { waitUntil: 'networkidle2' });

console.log('1) 注册一个家庭成员');
await page.click('[data-tab="register"]');
await page.type('#form-register input[name="username"]', 'xiaoli');
await page.type('#form-register input[name="displayName"]', '小李');
await page.type('#form-register input[name="password"]', '123456');
await page.click('#form-register button[type="submit"]');
await sleep(1500);
await shot('30-lobby-registered');

console.log('2) 退出并以管理员登录');
await page.evaluate(() => window.App.logout());
await sleep(1200);
await page.evaluate(() => document.querySelector('[data-tab="login"]')?.click());
await sleep(300);
await page.type('#form-login input[name="username"]', 'admin');
await page.type('#form-login input[name="password"]', 'admin');
await page.click('#form-login button[type="submit"]');
await sleep(1500);
await shot('31-admin-lobby');

console.log('3) 打开管理后台');
await page.evaluate(() => document.getElementById('btn-goto-admin')?.click());
await sleep(1200);
await shot('32-admin-panel');

const info = await page.evaluate(() => ({
  rows: document.querySelectorAll('#admin-tbody tr').length,
  sub: document.getElementById('admin-sub')?.textContent,
}));
console.log('   账号行数:', info.rows, '|', info.sub);

console.log('4) 编辑用户弹窗');
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#admin-tbody [data-act="edit"]')].find((b) => b.closest('tr').innerText.includes('xiaoli'));
  btn?.click();
});
await sleep(700);
await shot('33-admin-edit');

console.log('5) 修改昵称并保存');
await page.evaluate(() => {
  const input = document.querySelector('.modal input[name="displayName"]');
  if (input) { input.value = '小李子'; input.dispatchEvent(new Event('input', { bubbles: true })); }
  document.querySelector('.modal [data-act="save"]')?.click();
});
await sleep(1200);
const saved = await page.evaluate(() =>
  [...document.querySelectorAll('#admin-tbody tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
console.log('   保存后列表:');
saved.forEach((r) => console.log('     ', r));
await shot('34-admin-saved');

console.log('6) 停用账号');
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#admin-tbody [data-act="toggle"]')].find((b) => b.closest('tr').innerText.includes('xiaoli'));
  btn?.click();
});
await sleep(1000);
await shot('35-admin-disabled');

await browser.close();
console.log('\n页面错误:', errors.length);
errors.slice(0, 8).forEach((e) => console.log('  !', e));
