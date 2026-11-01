/**
 * 端到端联调测试：通过真实 Socket.IO 连接模拟多个玩家，
 * 验证「全手动流程、手牌隐私、结算数据完整、机器人调度」。
 * 需先启动服务：npm start（或 PORT=9876 node server/index.js）
 */
import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://127.0.0.1:9876';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else {
    failed += 1;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(label) {
    this.label = label;
    this.socket = io(URL, { transports: ['websocket'], reconnection: false });
    this.room = null;
    this.user = null;
    this.seq = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket.on('connect', resolve);
      this.socket.on('connect_error', reject);
      this.socket.on('auth:ok', (p) => { this.user = p.user; });
      this.socket.on('room:state', (s) => { this.room = s; this.seq += 1; });
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
    throw new Error(`等待超时 ${label}（当前 phase=${this.room?.game?.phase}）`);
  }
}

async function main() {
  console.log('\n端到端联调测试\n' + '─'.repeat(50));

  /* ---------- 场景一：两名真人，完整一局 ---------- */
  const A = new Client('A');
  const B = new Client('B');
  await A.connect();
  await B.connect();
  await A.guest('房主阿甲');
  await B.guest('闲家阿乙');

  const created = await A.call('room:create', {
    gameId: 'tuibingzi',
    config: { playerCount: 2, erbaMax: false, botFill: false },
  });
  check('创建房间成功', !created.error, created.error);
  const roomId = created.roomId;

  const joined = await B.call('room:join', { roomId });
  check('第二位玩家加入成功', !joined.error, joined.error);

  await A.waitFor((r) => r.players.length === 2, 4000, '两人入座');
  check('房主为初始庄家（座位 0）', A.room.game === null && A.room.mySeat === 0);

  // 未准备不应开局
  await sleep(400);
  check('未全部准备时不会自动开局', A.room.status === 'waiting');

  await A.call('room:ready', { ready: true });
  await sleep(300);
  check('只有一人准备时仍未开局', A.room.status === 'waiting');

  await B.call('room:ready', { ready: true });
  await A.waitFor((r) => r.status === 'playing', 4000, '开局');
  check('全员准备后自动进入牌局', A.room.status === 'playing');
  check('开局阶段为「洗牌」', A.room.game.phase === 'shuffle');

  // 非庄家不能洗牌
  const badShuffle = await B.call('game:action', { type: 'shuffle', payload: {} });
  check('非庄家无法洗牌', !!badShuffle.error);

  await A.call('game:action', { type: 'shuffle', payload: {} });
  await A.waitFor((r) => r.game.phase === 'cut_dice', 3000, '洗牌完成');
  check('洗牌后进入掷骰定切牌人阶段', A.room.game.phase === 'cut_dice');
  check('牌墙共 40 张', A.room.game.wallLeft === 40);

  // 静止检查：不应该自动跳步
  const phaseBefore = A.room.game.phase;
  await sleep(1200);
  check('无操作时流程不会自动推进', A.room.game.phase === phaseBefore);

  await A.call('game:action', { type: 'rollCutDice', payload: {} });
  await A.waitFor((r) => ['cut_choice', 'bet'].includes(r.game.phase), 3000, '切牌骰结果');

  const cutPhase = A.room.game.phase;
  const cutSeat = A.room.game.cut.bySeat;
  check('掷骰后进入切牌选择或直接押酒', ['cut_choice', 'bet'].includes(cutPhase));

  if (cutPhase === 'cut_choice') {
    const cutter = cutSeat === 0 ? A : B;
    const other = cutSeat === 0 ? B : A;
    const bad = await other.call('game:action', { type: 'cut', payload: {} });
    check('非被点中玩家不能切牌', !!bad.error);
    const skip = await cutter.call('game:action', { type: 'skipCut', payload: {} });
    check('被点中玩家选择「不切牌」', !skip.error, skip.error);
    await A.waitFor((r) => r.game.phase === 'bet', 3000, '进入押酒');
  }
  check('进入押酒阶段', A.room.game.phase === 'bet');

  // 庄家不能押酒
  const dealerBet = await A.call('game:action', { type: 'bet', payload: { cups: 1 } });
  check('庄家无需押酒（被拒绝）', !!dealerBet.error);

  const betRes = await B.call('game:action', { type: 'bet', payload: { cups: 2 } });
  check('闲家押酒 2 杯成功', !betRes.error, betRes.error);
  await A.waitFor((r) => r.game.phase === 'deal_dice', 3000, '押酒完成');
  check('全员押酒后进入掷骰发牌', A.room.game.phase === 'deal_dice');

  await A.call('game:action', { type: 'rollDealDice', payload: {} });
  await A.waitFor((r) => r.game.phase === 'reveal_dealer', 3000, '发牌完成');
  await B.waitFor((r) => r.game.phase === 'reveal_dealer', 3000, 'B 收到发牌状态');
  check('发牌后进入庄家亮牌阶段', A.room.game.phase === 'reveal_dealer');
  check('牌墙消耗 4 张', A.room.game.wallLeft === 36);

  // 隐私：B 看不到 A 的手牌
  const aInB = B.room.players.find((p) => p.seat === 0);
  check('未亮牌时对手手牌不可见（null）', aInB.hand === null);
  check('自己手牌可见且为 2 张', B.room.myHand.length === 2 && A.room.myHand.length === 2);
  check('对手仅能拿到手牌张数', aInB.handCount === 2);

  // 未亮庄家牌不能先亮闲家
  const earlyReveal = await B.call('game:action', { type: 'revealSelf', payload: {} });
  check('庄家未亮牌时闲家不能亮牌', !!earlyReveal.error);

  await A.call('game:action', { type: 'revealDealer', payload: {} });
  await A.waitFor((r) => r.game.phase === 'reveal_players', 3000, '庄家亮牌');
  await B.waitFor((r) => r.game.phase === 'reveal_players', 3000, 'B 收到庄家亮牌');
  const aRevealed = B.room.players.find((p) => p.seat === 0);
  check('庄家亮牌后手牌对所有人可见', Array.isArray(aRevealed.hand) && aRevealed.hand.length === 2);

  await B.call('game:action', { type: 'revealSelf', payload: {} });
  await A.waitFor((r) => r.game.phase === 'settle', 3000, '结算');
  await B.waitFor((r) => r.game.phase === 'settle', 3000, 'B 收到结算');
  check('闲家亮牌后进入结算', A.room.game.phase === 'settle');

  const results = A.room.game.results;
  check('结算含庄家汇总行', !!results?.dealerRow);
  check('结算明细数量 = 闲家数量', results?.rows?.length === 1);
  const row = results.rows[0];
  check('明细包含牌型/点数/押酒/胜杯/负杯',
    typeof row.handName === 'string' && typeof row.points === 'number'
    && row.bet === 2 && typeof row.cupsWon === 'number' && typeof row.cupsLost === 'number');
  check('对子翻倍倍率为 2 或 1', [1, 2].includes(row.multiplier));
  check('庄家总胜/总负与明细一致',
    results.dealer.won === results.rows.reduce((a, r) => a + r.cupsLost, 0)
    && results.dealer.lost === results.rows.reduce((a, r) => a + r.cupsWon, 0));

  // 闲家不能开下一局
  const badNext = await B.call('game:action', { type: 'nextRound', payload: {} });
  check('非庄家不能开启下一局', !!badNext.error);

  const nextRes = await A.call('game:action', { type: 'nextRound', payload: {} });
  check('庄家开启下一局成功', !nextRes.error, nextRes.error);
  await A.waitFor((r) => r.game.phase === 'bet', 3000, '下一局押酒');
  check('下一局直接从押酒开始（不重复洗牌）', A.room.game.phase === 'bet');
  check('下一局局号递增', A.room.game.roundNo === 2);
  check('牌墙延续使用（剩余 36 张）', A.room.game.wallLeft === 36);

  /* ---------- 场景二：机器人补位 ---------- */
  const C = new Client('C');
  await C.connect();
  await C.guest('机器人房主');
  const created2 = await C.call('room:create', {
    gameId: 'tuibingzi',
    config: { playerCount: 3, erbaMax: true, botFill: true },
  });
  check('创建带机器人的房间', !created2.error, created2.error);

  const fill = await C.call('room:fillBots', {});
  check('一键填满机器人', !fill.error && fill.added === 2, JSON.stringify(fill));

  await C.call('room:ready', { ready: true });
  await C.waitFor((r) => r.status === 'playing', 5000, '机器人房间开局');
  check('机器人自动准备并开局', C.room.status === 'playing');
  check('二八最大配置已生效', C.room.game.config.erbaMax === true);

  await C.call('game:action', { type: 'shuffle', payload: {} });
  await C.waitFor((r) => r.game.phase === 'cut_dice', 3000, '洗牌');
  await C.call('game:action', { type: 'rollCutDice', payload: {} });
  await C.waitFor((r) => ['cut_choice', 'bet'].includes(r.game.phase), 4000, '切牌骰');

  // 若命中机器人，机器人会自行决定；命中房主则手动处理
  await sleep(2200);
  if (C.room.game.phase === 'cut_choice' && C.room.game.cut.bySeat === C.room.mySeat) {
    await C.call('game:action', { type: 'skipCut', payload: {} });
  }
  // 机器人可能已经押完酒并推进到发牌，因此接受「押酒或更后」的阶段
  await C.waitFor(
    (r) => ['bet', 'deal_dice', 'reveal_dealer'].includes(r.game.phase),
    10000,
    '进入押酒'
  );

  // 机器人自动押酒
  await C.waitFor((r) => r.game.phase === 'deal_dice', 9000, '机器人押酒完成');
  check('机器人自动完成押酒', C.room.game.phase === 'deal_dice');
  check('押酒杯数累加正确', (C.room.game.bets || []).filter((b) => b > 0).length === 2);

  await C.call('game:action', { type: 'rollDealDice', payload: {} });
  await C.waitFor((r) => r.game.phase === 'reveal_dealer', 4000, '发牌');
  await C.call('game:action', { type: 'revealDealer', payload: {} });
  await C.waitFor((r) => r.game.phase === 'settle', 12000, '机器人亮牌结算');
  check('机器人自动亮牌并完成结算', C.room.game.phase === 'settle');
  check('三名玩家均有结算明细', C.room.game.results?.rows?.length === 2);

  /* ---------- 场景三：权限与隐私 ---------- */
  const hacked = await B.call('game:action', { type: 'revealSelf', payload: {} });
  check('越权操作被拒绝', !!hacked.error);

  const adminList = await B.call('admin:list', {});
  check('非管理员无法访问后台', !!adminList.error, JSON.stringify(adminList));

  const D = new Client('D');
  await D.connect();
  const loginRes = await D.call('auth:login', { username: 'admin', password: 'admin' });
  check('管理员账号可登录', !loginRes.error && loginRes.user.isAdmin === true, loginRes.error);

  const list = await D.call('admin:list', {});
  check('管理员可读取用户列表', Array.isArray(list.users));

  const wrongLogin = await D.call('auth:login', { username: 'admin', password: 'wrong' });
  check('错误密码被拒绝', !!wrongLogin.error);

  [A, B, C, D].forEach((c) => c.socket.close());

  /* ---------- 汇总 ---------- */
  console.log('─'.repeat(50));
  console.log(`通过 ${passed} / ${passed + failed}${failed ? ` · 失败 ${failed}` : ''}`);
  if (failed) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
    process.exit(1);
  }
  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[测试异常]', err.message);
  process.exit(1);
});
