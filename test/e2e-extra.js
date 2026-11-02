/**
 * 补充端到端测试：观战 / 积分商城（1.0.0 新增功能）
 * 需先启动服务：npm start（或 PORT=9876 node server/index.js）
 */
import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://127.0.0.1:9876';

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(label) {
    this.label = label;
    this.room = null;
    this.user = null;
    this.socket = io(URL, { transports: ['websocket'], reconnection: false });
    this.socket.on('auth:ok', (p) => { this.user = p.user; });
    this.socket.on('room:state', (s) => { this.room = s; });
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket.on('connect', resolve);
      this.socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('connect timeout')), 8000);
    });
  }

  call(ev, payload = {}) {
    return new Promise((resolve) => {
      this.socket.emit(ev, payload, (res) => resolve(res || {}));
      setTimeout(() => resolve({ error: 'timeout' }), 9000);
    });
  }

  async guest(name) {
    const res = await this.call('auth:guest', { name });
    if (res.error) throw new Error(res.error);
    this.user = res.user;
    return this;
  }

  async waitFor(predicate, timeout = 6000, label = '') {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.room && predicate(this.room)) return true;
      await sleep(60);
    }
    throw new Error(`等待超时 ${label}`);
  }

  close() { this.socket.disconnect(); }
}

async function main() {
  console.log('\n观战 / 商城 端到端测试\n' + '─'.repeat(50));

  /* ---------- 场景一：观战 ---------- */
  console.log('1) 开局后第三方观战');
  const A = new Client('A');
  const S = new Client('S');
  const G = new Client('G');
  await Promise.all([A.connect(), S.connect(), G.connect()]);
  await A.guest('房主观战测');
  await S.guest('观众甲');
  await G.guest('游客乙');

  const created = await A.call('room:create', {
    gameId: 'supermeng',
    config: { playerCount: 4, withJoker: true, orderRule: 'straightFirst', betMax: 3 },
  });
  check('创建房间成功', !!created.roomId, created.error);
  const roomId = created.roomId;
  await A.waitFor((r) => r.id, 5000, '进房');
  await A.call('room:fillBots', {});
  await sleep(500);
  await A.call('room:ready', { ready: true });
  await A.waitFor((r) => r.game, 6000, '开局');
  const playerCount = A.room.players.length;
  check('开局成功（含机器人）', playerCount === 4, `players=${playerCount}`);

  const spec = await S.call('room:spectate', { roomId });
  check('观战加入成功', !!spec.ok, spec.error);
  await S.waitFor((r) => r.isSpectator === true, 4000, '观战视角');
  check('身份标记为观战者', S.room.isSpectator === true);
  check('观战者不占座位（座位数不变）', S.room.players.length === playerCount, `players=${S.room.players.length}`);
  check('观战者无自己的手牌', (S.room.myHand || []).length === 0);
  check('观战列表中出现该观众', (S.room.spectators || []).some((s) => s.name === '观众甲'));
  const anyHandVisible = (S.room.players || []).some((p) => Array.isArray(p.hand) && p.hand.length > 0);
  check('普通观战者看不到任何玩家手牌', anyHandVisible === false);
  check('观战者看不到操作提示（hints 为空）', !S.room.hints);

  console.log('2) 观战者不能出牌');
  const specAction = await S.call('game:action', { type: 'shuffle', payload: {} });
  check('观战者操作被拒绝', !!specAction.error, JSON.stringify(specAction));

  console.log('3) 退出观战不影响牌局');
  const phaseBefore = A.room.game.phase;
  await S.call('room:leave', {});
  await sleep(600);
  const afterLeave = A.room;
  check('退出后观战列表清空', (afterLeave.spectators || []).length === 0);
  check('牌局仍在进行（不受影响）', afterLeave.status === 'playing' && withinPhase(afterLeave.game.phase, phaseBefore) === true);

  console.log('4) 未开局房间不能观战');
  const B = new Client('B');
  await B.connect();
  await B.guest('观战失败测');
  const room2 = await A.call('room:create', { gameId: 'tuibingzi', config: { playerCount: 2 } });
  const spec2 = await B.call('room:spectate', { roomId: room2.roomId });
  check('等待中的房间拒绝观战（直接加入即可）', !!spec2.error, JSON.stringify(spec2));

  A.close(); S.close(); G.close(); B.close();

  /* ---------- 场景二：积分商城 ---------- */
  console.log('5) 积分商城');
  const U = new Client('U');
  const V = new Client('V');
  await Promise.all([U.connect(), V.connect()]);

  const suffix = String(Date.now()).slice(-6);
  const uname = `shop_${suffix}`;
  const reg = await U.call('auth:register', { username: uname, password: 'pass1234', displayName: '商城测试' });
  check('注册账号成功', !!reg.ok, reg.error);

  const list = await U.call('shop:list', {});
  check('商城可列出商品', list.ok === true && Array.isArray(list.items) && list.items.length >= 1, JSON.stringify(list).slice(0, 120));
  check('新账号初始积分 1000', list.points === 1000, `points=${list.points}`);
  const item = list.items.find((i) => i.id === 'clear_stats');
  check('存在「胜率清零卡」且售价 50 积分', !!item && item.price === 50, JSON.stringify(item));

  const buy = await U.call('shop:buy', { itemId: 'clear_stats' });
  check('购买成功', buy.ok === true, buy.error);
  check('购买后积分扣减为 950', buy.points === 950, `points=${buy.points}`);

  const badBuy = await U.call('shop:buy', { itemId: 'not_exist' });
  check('不存在的商品被拒绝', !!badBuy.error, JSON.stringify(badBuy));

  await V.guest('游客买不了');
  const guestList = await V.call('shop:list', {});
  check('游客可查看商城（无积分）', guestList.ok === true && guestList.guest === true && guestList.points === 0, JSON.stringify(guestList));
  const guestBuy = await V.call('shop:buy', { itemId: 'clear_stats' });
  check('游客购买被拒绝', !!guestBuy.error, JSON.stringify(guestBuy));

  U.close(); V.close();

  console.log('─'.repeat(50));
  console.log(`通过 ${passed} / ${passed + failed}`);
  if (failed) process.exit(1);
}

// 允许阶段因机器人推进而变化，只需确认牌局没被打断
function withinPhase(now, before) {
  return typeof now === 'string' && now.length > 0;
}

main().catch((err) => {
  console.error('测试异常：', err);
  process.exit(1);
});
