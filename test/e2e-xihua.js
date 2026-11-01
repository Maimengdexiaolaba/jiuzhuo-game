/**
 * 纸牌西游记 · Socket 端到端测试
 * 覆盖：双模式开局、手牌隐私、罚酒确认、结算、战绩落库。
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
    this.token = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket.on('connect', resolve);
      this.socket.on('connect_error', reject);
      this.socket.on('auth:ok', (p) => { this.user = p.user; this.token = p.token; });
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

async function playOneGame(client, maxSteps = 400) {
  let steps = 0;
  let penalties = 0;
  while (steps < maxSteps) {
    steps += 1;
    const s = client.room;
    if (!s || !s.game) { await sleep(200); continue; }
    const g = s.game;
    if (g.phase === 'settle') return { ok: true, penalties };

    if (g.phase === 'penalty') {
      if (g.penalty && g.penalty.seat === s.mySeat) {
        penalties += 1;
        await client.call('game:action', { type: 'ackPenalty', payload: {} });
      }
      await sleep(320);
      continue;
    }

    if (g.phase === 'play' && g.currentSeat === s.mySeat) {
      const ranks = s.hints?.playable || [];
      if (ranks.length) {
        const rank = ranks[0];
        const cards = s.myHand.filter((c) => c.rank === rank);
        const need = g.table ? g.table.count : 1;
        const cardIds = cards.slice(0, need).map((c) => c.id);
        const r = await client.call('game:action', { type: 'play', payload: { cardIds } });
        if (r.error) await client.call('game:action', { type: 'pass', payload: {} });
      } else if (g.table) {
        await client.call('game:action', { type: 'pass', payload: {} });
      } else {
        const c = s.myHand[0];
        if (c) await client.call('game:action', { type: 'play', payload: { cardIds: [c.id] } });
      }
      await sleep(300);
    } else {
      await sleep(300);
    }
  }
  return { ok: false, steps };
}

async function main() {
  console.log('\n纸牌西游记 · 端到端测试\n' + '─'.repeat(50));

  const H = new Client('H');
  await H.connect();

  const uname = `xh${Date.now().toString().slice(-7)}`;
  const reg = await H.call('auth:register', { username: uname, displayName: '西游玩家', password: '123456' });
  check('注册账号成功', !reg.error, reg.error);

  /* ---------- 54 张模式，2 人对战 ---------- */
  const created = await H.call('room:create', {
    gameId: 'xihua',
    config: { playerCount: 2, mode: 'a54', penalty: 'two', botFill: true },
  });
  check('创建西游记房间（54 张 / 2 人）', !created.error, created.error);
  const roomId = created.roomId;

  const lobby = await H.call('lobby:list', {});
  const summary = lobby.rooms.find((r) => r.id === roomId);
  check('大厅显示游戏类型为纸牌西游记', summary?.gameName === '纸牌西游记', summary?.gameName);
  check('大厅显示 54 张经典版配置', (summary?.configText || []).some((t) => t.includes('54 张')), JSON.stringify(summary?.configText));

  await H.call('room:addBot', {});
  await H.waitFor((r) => r.players.length === 2, 4000, '机器人入座');
  await H.call('room:ready', { ready: true });
  await H.waitFor((r) => r.status === 'playing', 5000, '开局');
  check('全员准备后自动开局', H.room.status === 'playing');
  check('54 张 2 人局各发 27 张', H.room.myHand.length === 27, `实际 ${H.room.myHand?.length}`);

  const opp = H.room.players.find((p) => p.seat !== H.room.mySeat);
  check('对手手牌不可见（null）', opp.hand === null);
  check('对手只暴露手牌张数', opp.handCount === 27);

  const g0 = H.room.game;
  check('模式字段为 a54', g0.mode === 'a54');
  const iHaveH4 = H.room.myHand.some((c) => c.id === 'h4');
  check('54 张由持红桃 4 者先出', (g0.firstSeat === H.room.mySeat) === iHaveH4, `firstSeat=${g0.firstSeat} 我持红桃4=${iHaveH4}`);

  // 别人出牌应被拒绝
  const badPlay = await H.call('game:action', { type: 'play', payload: { cardIds: ['none'] } });
  check('非法出牌被拒绝', !!badPlay.error, JSON.stringify(badPlay));

  const r1 = await playOneGame(H);
  check('54 张局可跑到结算', r1.ok, `steps=${r1.steps}`);
  check('结算包含全部座位', H.room.game.results.entries.length === 2);

  const res = H.room.game.results;
  check('结算有第一名', res.winnerSeat === res.entries[0].seat);
  check('名次连续', res.entries.every((e, i) => e.place === i + 1));
  check('最后一名按剩余手牌罚杯', res.entries[res.entries.length - 1].penaltyCups >= 0);

  /* ---------- 下一局由第一名先出 ---------- */
  const isWinner = res.winnerSeat === H.room.mySeat;
  const next = await H.call('game:action', { type: 'nextRound', payload: {} });
  if (isWinner) {
    check('第一名可以开启下一局', !next.error, next.error);
    await H.waitFor((r) => r.game.roundNo === 2, 4000, '第二局');
    check('第二局由上一局第一名先出', H.room.game.firstSeat === res.winnerSeat);
  } else {
    check('非第一名不能开启下一局', !!next.error, JSON.stringify(next));
  }

  /* ---------- 36 张模式 ---------- */
  const H2 = new Client('H2');
  await H2.connect();
  await H2.call('auth:guest', { name: '精简玩家' });
  const c2 = await H2.call('room:create', {
    gameId: 'xihua',
    config: { playerCount: 4, mode: 'b36', penalty: 'one', botFill: true },
  });
  check('创建 36 张精简版房间', !c2.error, c2.error);
  await H2.call('room:fillBots', {});
  await H2.waitFor((r) => r.players.length === 4, 4000, '机器人填满');
  await H2.call('room:ready', { ready: true });
  await H2.waitFor((r) => r.status === 'playing', 5000, '开局');
  check('36 张 4 人局各发 9 张', H2.room.myHand.length === 9, `实际 ${H2.room.myHand?.length}`);
  check('B 模式字段正确', H2.room.game.mode === 'b36' && H2.room.game.penaltyMode === 'one');
  check('B 模式存在惩罚区计数', Array.isArray(H2.room.game.penaltyZoneCounts));
  check('36 张由房主先出', H2.room.game.firstSeat === 0, `firstSeat=${H2.room.game.firstSeat}`);

  const r2 = await playOneGame(H2);
  check('36 张局可跑到结算', r2.ok, `steps=${r2.steps}`);
  const res2 = H2.room.game.results;
  check('B 模式逐位给出惩罚区张数', res2.entries.every((e) => typeof e.zoneCount === 'number'));
  check('1 张 1 杯换算正确', res2.entries.every((e) => e.cups === e.zoneCount));
  check('最后一名手牌并入惩罚区', res2.entries[res2.entries.length - 1].zoneCount >= res2.entries[res2.entries.length - 1].remaining);

  /* ---------- 百场战绩 ---------- */
  const stats = await H.call('me:stats', {});
  const xh = (stats.stats || []).find((s) => s.gameId === 'xihua');
  check('西游记已写入百场战绩', !!xh && xh.played >= 1, JSON.stringify(stats.stats));
  check('胜率在 0~100 之间', xh && xh.winRate >= 0 && xh.winRate <= 100, String(xh?.winRate));

  /* ---------- 10 人房 ---------- */
  const H3 = new Client('H3');
  await H3.connect();
  await H3.call('auth:guest', { name: '十人房' });
  const c3 = await H3.call('room:create', { gameId: 'xihua', config: { playerCount: 10, mode: 'a54' } });
  check('支持 10 人房', !c3.error, c3.error);
  await H3.call('room:fillBots', {});
  await H3.waitFor((r) => r.players.length === 10, 5000, '10 人填满');
  await H3.call('room:ready', { ready: true });
  await H3.waitFor((r) => r.status === 'playing', 6000, '10 人开局');
  check('10 人局各发 5 张（54÷10 余 4 张作底牌）', H3.room.myHand.length === 5, `实际 ${H3.room.myHand?.length}`);
  check('底牌 4 张未发出', H3.room.game.bottomCount === 4, `bottom=${H3.room.game.bottomCount}`);

  [H, H2, H3].forEach((c) => c.close());

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
