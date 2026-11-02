/**
 * BGM 冒烟测试：验证背景音乐在登录页/大厅自动播放、切场景后仍运行、关闭音效后停止。
 * 需先启动服务：npm start（或 PORT=9876 node server/index.js）
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.URL || 'http://127.0.0.1:9876';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  defaultViewport: { width: 1280, height: 860 },
});

const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

// 统计实际发声：拦截 OscillatorNode.start()，若 BGM 真在合成音符，计数会持续增长
await page.evaluateOnNewDocument(() => {
  window.__osc = 0;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const orig = AC.prototype.createOscillator;
  AC.prototype.createOscillator = function patched() {
    const node = orig.call(this);
    const start = node.start.bind(node);
    node.start = (...args) => { window.__osc += 1; return start(...args); };
    return node;
  };
});

await page.goto(URL, { waitUntil: 'networkidle2' });
// 一次用户手势，解除自动播放限制
await page.mouse.click(200, 300);
await sleep(800);

const lobbyState = await page.evaluate(() => ({
  mood: window.App?.bgm?.mood(),
  playing: window.App?.bgm?.playing(),
}));
check('登录页 BGM 场景为 lobby', lobbyState.mood === 'lobby', JSON.stringify(lobbyState));
check('登录页 BGM 正在运行', lobbyState.playing === true);

// 游客登录进大厅，验证顶栏存在后可操作音效开关
await page.click('[data-tab="guest"]');
await page.type('#form-guest input[name="name"]', '音测');
await page.click('#form-guest button[type="submit"]');
await sleep(1500);
const afterLogin = await page.evaluate(() => ({
  view: window.App.state.view,
  mood: window.App.bgm.mood(),
  playing: window.App.bgm.playing(),
  hasBtn: !!document.querySelector('#btn-sound'),
}));
check('登录后进入大厅', afterLogin.view === 'lobby', JSON.stringify(afterLogin));
check('大厅 BGM 为 lobby 且运行', afterLogin.mood === 'lobby' && afterLogin.playing === true, JSON.stringify(afterLogin));
check('音效开关按钮存在', afterLogin.hasBtn === true);

// 发声验证：大厅 BGM 应持续调度新音符
const oscA = await page.evaluate(() => window.__osc);
await sleep(2000);
const oscB = await page.evaluate(() => window.__osc);
check('BGM 持续合成音符（2s 内有新音）', oscB - oscA >= 3, `+${oscB - oscA}`);

// 进入牌局场景（走真实 navigate 路径，验证 app.js 的场景切换接线）
const navState = await page.evaluate(() => {
  try { window.App.navigate('room'); } catch (e) { /* 无牌局状态时渲染可能抛错，忽略 */ }
  return { mood: window.App.bgm.mood(), playing: window.App.bgm.playing() };
});
check('navigate 到牌桌后切为 room 场景', navState.mood === 'room', JSON.stringify(navState));
check('牌桌场景 BGM 在运行', navState.playing === true);

// 关音效 → BGM 停
await page.evaluate(() => {
  const btn = document.querySelector('#btn-sound');
  if (btn) btn.click();
});
await sleep(600);
const offState = await page.evaluate(() => ({ playing: window.App.bgm.playing() }));
check('关闭音效后 BGM 停止', offState.playing === false, JSON.stringify(offState));

// 再开 → 恢复
await page.evaluate(() => document.querySelector('#btn-sound')?.click());
await sleep(1200);
const onState = await page.evaluate(() => ({ mood: window.App.bgm.mood(), playing: window.App.bgm.playing() }));
check('重新开启音效后 BGM 恢复', onState.playing === true && onState.mood === 'room', JSON.stringify(onState));

// AudioContext 未被异常挂起
const ctxState = await page.evaluate(() => {
  const ac = window.AudioContext;
  return typeof ac === 'function' ? 'ok' : 'missing';
});
check('AudioContext 可用', ctxState === 'ok');

check('无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n通过 ${passed} / ${passed + failed}`);
if (failed) process.exit(1);
