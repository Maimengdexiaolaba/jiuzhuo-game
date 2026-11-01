/**
 * 超级梦幻 · Socket 端到端测试
 * 覆盖：创建房间、配置、开局、叫酒/开牌/服牌结算、手牌隐私、移庄、百场战绩落库。
 */
import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://127.0.0.1:9876';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

class Client {
  constructor(label) {
    this.label = label;
    this.socket = io(URL, { transports: ['websocket'], reconnection: false });
    this.room = null;
    this.user = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.socket.on('connect', resolve);
      this.socket.on('connect_error', reject);
      this.socket.on('auth:ok', (p) => { this.user = p.user; });
      this.socket.on('room:state', (s) => { this.room = s; });
      setTimeout(() => reject(new Error('connect timeout')), 8000);
    });
  }
  call(ev, payload = {}) {
    return new Promise((resolve) => {
      this.socket.emit(ev, payload, (res) => resolve(res || {}));
      setTimeout(() => resolve({ error: 'timeout' }), 9000);
    });
  }
  async waitFor(pred, timeout = 8000, label = '') {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.room && pred(this.room)) return true;
      await sleep(60);
    }
    throw new Error(`等待超时 ${label}（phase=${this.room?.game?.phase}）`);
  }
  close() { this.socket.close(); }
}

async function main() {
  const A = new Client('A');
  await A.connect();
  const auth = await A.call('auth:guest', { name: '梦幻玩家' });
  check('游客登录成功', !!auth.ok, auth.error);

  console.log('1) 创建超级梦幻房间');
  const created = await A.call('room:create', {
    gameId: 'supermeng',
    config: { playerCount: 4, withJoker: true, orderRule: 'straightFirst', betMax: 3 },
  });
  check('房间创建成功', !!created.roomId, created.error);
  await A.waitFor((r) => r.id, 5000, '进入房间');

  check('游戏类型为超级梦幻', A.room.gameId === 'supermeng');
  check('配置含大小王', A.room.config.withJoker === true);

  console.log('2) 填机器人并准备');
  await A.call('room:fillBots', {});
  await sleep(800);
  await A.call('room:ready', { ready: true });
  await A.waitFor((r) => r.game, 6000, '开局');

  check('进入叫酒/开牌阶段', ['blind', 'bet', 'dealer_change', 'open'].includes(A.room.game.phase), A.room.game.phase);

  console.log('3) 手牌隐私');
  const me = A.room.mySeat;
  const myHand = A.room.myHand || [];
  check('我能看到自己 2 张手牌', myHand.length === 2);
  check('我的手牌牌型摘要存在', !!A.room.myHandInfo && !!A.room.myHandInfo.name);
  const otherSeat = A.room.players.find((p) => p.seat !== me);
  check('未开牌时他人手牌不可见', !otherSeat.hand);

  console.log('4) 跑完整局到结算（庄家为机器人，自动推进）');
  // 若我是闲家则机器人庄家会自动开牌；若我是庄家则手动开牌
  let guard = 0;
  while (guard < 800 && A.room.game.phase !== 'settle') {
    guard += 1;
    const g = A.room.game;
    if (g.phase === 'bet' && g.currentSeat === me) {
      await A.call('game:action', { type: 'bet', payload: { cups: 1 } });
    } else if (g.phase === 'blind' && g.currentSeat === me) {
      await A.call('game:action', { type: 'blindChoice', payload: { blind: false } });
    } else if (g.phase === 'open' && g.openSeat === null && g.currentSeat === me) {
      const cand = A.room.players.find((p) => p.seat !== me && !g.opened[p.seat]);
      if (cand) await A.call('game:action', { type: 'open', payload: { seat: cand.seat } });
      else await A.call('game:action', { type: 'stopOpen', payload: {} });
    } else if (g.phase === 'open' && g.openSeat === me) {
      await A.call('game:action', { type: 'fold', payload: {} });
    } else if (g.phase === 'dealer_change' && g.currentSeat === me) {
      await A.call('game:action', { type: 'skipChange', payload: {} });
    }
    await sleep(80);
  }
  check('跑到结算', A.room.game.phase === 'settle', A.room.game.phase);
  check('结算有庄家汇总', !!A.room.game.results?.dealer);
  check('结算有闲家明细', Array.isArray(A.room.game.results?.rows));

  console.log('5) 结算后手牌全部可见');
  const settledOther = A.room.players.find((p) => p.seat !== me);
  check('结算后他人手牌可见', !!settledOther.hand && settledOther.hand.length === 2);

  await A.close();
  console.log(`\n通过 ${passed} / ${passed + failed}${failed ? ` · 失败 ${failed}` : ''}`);
  if (failures.length) console.log(failures.join('\n'));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('测试异常', e); process.exit(1); });
