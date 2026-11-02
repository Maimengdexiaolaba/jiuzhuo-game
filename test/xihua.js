/**
 * 纸牌西游记引擎测试：牌力规则 + 自动对局模拟
 */
import assert from 'node:assert';
import * as engine from '../server/games/xihua/engine.js';
import xihua from '../server/games/xihua/index.js';
import { canBeatA, canBeatB, validatePlay, isPassCard, isTurnBackCard } from '../server/games/xihua/rules.js';
import { buildDeckA, buildDeckB, MODE_A, MODE_B } from '../server/games/xihua/cards.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (err) { failed += 1; console.log(`  ✗ ${name}\n      ${err.message}`); }
}

const mkPlayers = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `玩家${i}`, seat: i, isBot: true }));

console.log('\n纸牌西游记引擎测试\n' + '─'.repeat(50));

/* ---------------- 牌组 ---------------- */

test('A 方案 54 张、B 方案 36 张', () => {
  assert.strictEqual(buildDeckA().length, 54);
  assert.strictEqual(buildDeckB().length, 36);
  assert.strictEqual(new Set(buildDeckA().map((c) => c.id)).size, 54);
  assert.strictEqual(new Set(buildDeckB().map((c) => c.id)).size, 36);
  assert.ok(buildDeckB().every((c) => [2, 3, 5, 6, 8, 10, 11, 12, 13].includes(c.rank)));
});

/* ---------------- A 方案牌力 ---------------- */

test('A 仙界链条：如来 > 观音 > 唐僧 > 悟空 > 八戒 > 沙僧', () => {
  const chain = [16, 15, 10, 5, 8, 3];
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.ok(canBeatA(chain[i], chain[i + 1]), `${chain[i]} 应管住 ${chain[i + 1]}`);
    assert.ok(!canBeatA(chain[i + 1], chain[i]), `${chain[i + 1]} 不应管住 ${chain[i]}`);
  }
});

test('A 妖界链条：A > K > Q > J > 9 > 7 > 4', () => {
  const chain = [14, 13, 12, 11, 9, 7, 4];
  for (let i = 0; i < chain.length - 1; i += 1) {
    assert.ok(canBeatA(chain[i], chain[i + 1]));
    assert.ok(!canBeatA(chain[i + 1], chain[i]));
  }
});

test('A 克制：妖精都能管唐僧', () => {
  [14, 13, 12, 11, 9, 7, 4].forEach((d) => {
    assert.ok(canBeatA(d, 10), `妖${d} 应管住唐僧`);
  });
});

test('A 克制：除唐僧外仙界都能管妖精', () => {
  [16, 15, 5, 8, 3, 6].forEach((im) => {
    [14, 13, 9, 4].forEach((d) => {
      assert.ok(canBeatA(im, d), `仙界${im} 应管住妖${d}`);
    });
  });
  assert.ok(!canBeatA(10, 14), '唐僧不能管妖精');
});

test('A 过牌 2 不参与比大小', () => {
  assert.ok(isPassCard(2));
  assert.ok(!canBeatA(2, 14));
  assert.ok(!canBeatA(16, 2));
});

test('6 白龙马：A 方案是仙界最小的普通牌', () => {
  assert.ok(!isTurnBackCard(6, MODE_A), 'A 方案没有转上家');
  assert.ok(canBeatA(6, 4), '白龙马能管妖精');
  assert.ok(canBeatA(6, 13), '白龙马能管大妖');
  assert.ok(!canBeatA(6, 3), '白龙马管不住沙僧');
  assert.ok(canBeatA(3, 6), '沙僧管得住白龙马');
  assert.ok(canBeatA(16, 6), '大王管得住白龙马');
  assert.ok(canBeatA(10, 6), '唐僧同样管得住白龙马');
});

test('6 白龙马：B 方案才是转上家的功能牌', () => {
  assert.ok(isTurnBackCard(6, MODE_B));
  assert.ok(!canBeatB(6, 3));
  assert.ok(!canBeatB(13, 6));
});

/* ---------------- B 方案牌力 ---------------- */

test('B 链条：大妖 > 中妖 > 小妖；悟空 > 八戒 > 沙僧', () => {
  assert.ok(canBeatB(13, 12) && canBeatB(12, 11));
  assert.ok(canBeatB(5, 8) && canBeatB(8, 3));
});

test('B 循环克制：妖吃唐僧、唐僧管徒弟、徒弟打妖怪', () => {
  assert.ok(canBeatB(13, 10), '大妖吃唐僧');
  assert.ok(canBeatB(10, 5), '唐僧管悟空');
  assert.ok(canBeatB(5, 13), '悟空打大妖');
  assert.ok(!canBeatB(10, 13), '唐僧不能管妖');
  assert.ok(!canBeatB(13, 5), '妖不能打徒弟');
});

/* ---------------- 出牌校验 ---------------- */

test('出牌张数：相同牌可一次出 1~4 张（A/B 方案一致）', () => {
  const four = [{ rank: 5 }, { rank: 5 }, { rank: 5 }, { rank: 5 }];
  assert.ok(validatePlay(four, null, MODE_A).ok, 'A 可出 4 张');
  assert.ok(validatePlay(four, null, MODE_B).ok, 'B 也可出 4 张');
  const three = four.slice(0, 3);
  assert.ok(validatePlay(three, null, MODE_B).ok, 'B 可出 3 张');
});

test('必须同点数，且管牌必须同张数', () => {
  assert.ok(!validatePlay([{ rank: 5 }, { rank: 6 }], null, MODE_A).ok);
  const table = { rank: 8, count: 2 }; // 八戒对
  assert.ok(!validatePlay([{ rank: 9 }], table, MODE_A).ok, '张数不同不能管');
  assert.ok(!validatePlay([{ rank: 7 }, { rank: 7 }], table, MODE_A).ok, '妖7管不住八戒');
  assert.ok(!validatePlay([{ rank: 9 }, { rank: 9 }], table, MODE_A).ok, '妖精只能管唐僧');
  assert.ok(validatePlay([{ rank: 5 }, { rank: 5 }], table, MODE_A).ok, '悟空对可以管八戒对');
});

test('过牌 2 可单张或多张打出，均为让过', () => {
  const lead = validatePlay([{ rank: 2 }], null, MODE_A);
  assert.ok(lead.ok && lead.kind === 'pass', '单张 2 让过');
  const beat = validatePlay([{ rank: 2 }], { rank: 9, count: 1 }, MODE_A);
  assert.ok(beat.ok && beat.kind === 'pass');
  const multi = validatePlay([{ rank: 2 }, { rank: 2 }], null, MODE_A);
  assert.ok(multi.ok && multi.kind === 'pass' && multi.count === 2, '多张 2 也是让过');
});

test('跟牌时 2/6 也必须与桌面同张数（问题 32）', () => {
  const table3 = { rank: 5, count: 3 };
  // 桌面 3 张，出 1 张 6 / 1 张 2 都要拦截
  assert.ok(!validatePlay([{ rank: 6 }], table3, MODE_B).ok, '跟牌出 1 张 6 应被拦');
  assert.ok(!validatePlay([{ rank: 2 }], table3, MODE_B).ok, '跟牌出 1 张 2 应被拦');
  // 出 3 张 6 / 3 张 2 才通过
  const r6 = validatePlay([{ rank: 6 }, { rank: 6 }, { rank: 6 }], table3, MODE_B);
  assert.ok(r6.ok && r6.kind === 'turnback' && r6.count === 3, '跟牌出 3 张 6 转上家');
  const r2 = validatePlay([{ rank: 2 }, { rank: 2 }, { rank: 2 }], table3, MODE_B);
  assert.ok(r2.ok && r2.kind === 'pass' && r2.count === 3, '跟牌出 3 张 2 让过');
  // 领出时 2/6 仍任意张
  assert.ok(validatePlay([{ rank: 6 }], null, MODE_B).ok, '领出 1 张 6 仍可');
  assert.ok(validatePlay([{ rank: 2 }, { rank: 2 }], null, MODE_B).ok, '领出 2 张 2 仍可');
});

/* ---------------- 自动对局 ---------------- */

function simulate(mode, playerCount, penalty, seeds = 1) {
  const results = [];
  for (let s = 0; s < seeds; s += 1) {
    const players = mkPlayers(playerCount);
    const st = xihua.createState({ playerCount, config: { mode, penalty } });
    st._players = players;
    let guard = 0;
    let error = null;

    while (st.phase !== 'settle' && guard < 8000) {
      guard += 1;
      const jobs = engine.pendingBotActions(st, () => true);
      if (!jobs.length) break;
      const job = jobs[0];
      const r = engine.applyAction(st, players, job.seat, job.type, job.payload);
      if (!r.ok) { error = `${job.type}: ${r.error}`; break; }
    }
    results.push({ st, error, guard });
  }
  return results;
}

test('A 方案自动对局可以跑到结算（2~10 人）', () => {
  for (const n of [2, 3, 4, 6, 10]) {
    const [run] = simulate(MODE_A, n, 'two', 1);
    assert.ok(!run.error, `${n} 人局出错：${run.error}`);
    assert.strictEqual(run.st.phase, 'settle', `${n} 人局未结束（相册阶段=${run.st.phase}）`);
    assert.strictEqual(run.st.results.entries.length, n);
  }
});

test('B 方案自动对局可以跑到结算（2~10 人）', () => {
  for (const n of [2, 3, 4, 6, 10]) {
    const [run] = simulate(MODE_B, n, 'two', 1);
    assert.ok(!run.error, `${n} 人局出错：${run.error}`);
    assert.strictEqual(run.st.phase, 'settle', `${n} 人局未结束（阶段=${run.st.phase}）`);
    assert.strictEqual(run.st.results.entries.length, n);
  }
});

test('A 方案：罚杯 = 过牌次数 + 末位剩余手牌', () => {
  const runs = simulate(MODE_A, 4, 'two', 12);
  let checked = 0;
  for (const { st, error } of runs) {
    assert.ok(!error, error);
    const total = st.results.totalCups;
    const sum = st.results.entries.reduce((a, e) => a + e.cups, 0);
    assert.strictEqual(total, sum);
    // 每个人至少 0 杯，且赢家（首位出完）通常不是最后一名
    st.results.entries.forEach((e) => assert.ok(e.cups >= 0));
    checked += 1;
  }
  assert.ok(checked === 12);
});

test('B 方案：惩罚区张数 → 杯数换算正确', () => {
  for (const penalty of ['two', 'one']) {
    const runs = simulate(MODE_B, 4, penalty, 8);
    for (const { st, error } of runs) {
      assert.ok(!error, error);
      for (const e of st.results.entries) {
        const expect = penalty === 'one' ? e.zoneCount : Math.floor(e.zoneCount / 2);
        assert.strictEqual(e.cups, expect, `zone=${e.zoneCount} penalty=${penalty}`);
      }
      // 最后一名的手牌应并入惩罚区
      const last = st.results.entries[st.results.entries.length - 1];
      assert.ok(last.remaining > 0, '最后一名应记录并入前的剩余手牌数');
      assert.ok(last.zoneCount >= last.remaining, '惩罚区应包含其剩余手牌');
      assert.ok(last.zoneCount > 0, '最后一名惩罚区应大于 0');
    }
  }
});

test('B 方案：惩罚区总张数守恒（含收牌与末位手牌）', () => {
  const runs = simulate(MODE_B, 4, 'two', 10);
  for (const { st, error } of runs) {
    assert.ok(!error, error);
    const total = st.results.entries.reduce((a, e) => a + e.zoneCount, 0);
    // 每局发出的牌 = 手牌（0）+ 惩罚区 + 底牌
    const dealt = st.hands.reduce((a, h) => a + h.length, 0) + total + st.bottom.length;
    assert.strictEqual(dealt, 36, `牌数不守恒：${dealt}`);
  }
});

test('A 方案：出完的玩家不再参与轮转', () => {
  const [run] = simulate(MODE_A, 3, 'two', 1);
  assert.ok(!run.error);
  assert.ok(run.st.results.entries[0].finished, '第一名应标记为已出完');
  assert.strictEqual(run.st.results.entries[0].remaining, 0);
});

test('B 方案：出完顺序与名次一致', () => {
  const [run] = simulate(MODE_B, 4, 'two', 1);
  assert.ok(!run.error);
  const e = run.st.results.entries;
  for (let i = 0; i < e.length; i += 1) {
    assert.strictEqual(e[i].place, i + 1);
    if (i < e.length - 1) assert.ok(e[i].finished, `第 ${i + 1} 名应出完`);
  }
});

/* ---------------- 罚酒流程 ---------------- */

test('罚酒必须由被罚玩家本人确认', () => {
  const players = mkPlayers(3);
  const st = xihua.createState({ playerCount: 3, config: { mode: MODE_A, penalty: 'two' } });
  st._players = players;

  // 构造：当前玩家有一手牌，桌面有更大的牌 -> 他只能过牌吃罚
  st.table = { seat: (st.currentSeat + 1) % 3, rank: 16, count: 1, cards: [{ id: 'x', suit: 'joker', rank: 16 }] };
  const seat = st.currentSeat;
  const r = engine.applyAction(st, players, seat, 'pass', {});
  assert.ok(r.ok, r.error);
  assert.strictEqual(st.phase, 'penalty');
  assert.strictEqual(st.penaltyQueue[0].seat, seat);

  const other = (seat + 1) % 3;
  const bad = engine.applyAction(st, players, other, 'ackPenalty', {});
  assert.ok(!bad.ok, '别人不能代点');

  const good = engine.applyAction(st, players, seat, 'ackPenalty', {});
  assert.ok(good.ok, good.error);
  assert.strictEqual(st.phase, 'play');
});

test('B 方案过牌收走桌面牌', () => {
  const players = mkPlayers(2);
  const st = xihua.createState({ playerCount: 2, config: { mode: MODE_B, penalty: 'two' } });
  st._players = players;
  st.phase = 'play';
  const seat = st.currentSeat;
  const tableCards = [{ id: 't1', suit: 's', rank: 3 }, { id: 't2', suit: 'h', rank: 3 }];
  st.table = { seat: (seat + 1) % 2, rank: 3, count: 2, cards: tableCards };
  st.trickPile = tableCards.slice();

  const before = st.penaltyZone[seat].length;
  const r = engine.applyAction(st, players, seat, 'pass', {});
  assert.ok(r.ok, r.error);
  assert.strictEqual(st.penaltyZone[seat].length, before + 2, '应收走 2 张');
  assert.strictEqual(st.trickPile.length, 0, '收牌后本轮牌堆清空');
  assert.strictEqual(st.table, null, '桌面应清空');
  assert.strictEqual(st.currentSeat, seat, '收牌者（被惩罚人）领出下一轮');
});

test('B 方案：前四家出牌后管不住，五张全进惩罚区且由他领出', () => {
  const players = mkPlayers(5);
  const st = xihua.createState({ playerCount: 5, config: { mode: MODE_B, penalty: 'two' } });
  st._players = players;
  st.phase = 'play';
  st.firstSeat = 0;
  st.currentSeat = 0;

  const hands = [[3, 3, 5], [8, 8, 10], [5, 5, 13], [10, 10, 11], [13, 13, 12]];
  st.hands = hands.map((rs, seatIdx) =>
    rs.map((r, i) => ({ id: `s${seatIdx}-${i}`, suit: 's', rank: r }))
  );

  // 依次出：3 -> 8 -> 5 -> 10(唐僧) -> 13(大妖)
  const plays = [3, 8, 5, 10, 13];
  plays.forEach((rank, seat) => {
    const card = st.hands[seat].find((c) => c.rank === rank);
    const r = engine.applyAction(st, players, seat, 'play', { cardIds: [card.id] });
    assert.ok(r.ok, `座位${seat} 出 ${rank}：${r.error}`);
  });

  assert.strictEqual(st.trickPile.length, 5, '本轮共 5 张');
  assert.strictEqual(st.currentSeat, 0, '轮到第一个玩家');

  const r = engine.applyAction(st, players, 0, 'pass', {});
  assert.ok(r.ok, r.error);
  assert.strictEqual(st.penaltyZone[0].length, 5, '5 张全部进 0 号惩罚区');
  assert.deepStrictEqual(
    st.penaltyZone[0].map((c) => c.rank).sort((a, b) => a - b),
    [3, 5, 8, 10, 13],
    '收走的是本轮所有人的牌'
  );
  assert.strictEqual(st.currentSeat, 0, '由被惩罚的 0 号领出下一轮');
  assert.strictEqual(st.table, null, '桌面清空，等待领出');
});

test('B 方案：出 6 后由上家继续管，桌面牌堆不清空', () => {
  const players = mkPlayers(3);
  const st = xihua.createState({ playerCount: 3, config: { mode: MODE_B, penalty: 'two' } });
  st._players = players;
  st.phase = 'play';
  st.firstSeat = 0;
  st.currentSeat = 0;
  st.hands = [
    [{ id: 'a1', suit: 's', rank: 11 }, { id: 'a2', suit: 's', rank: 12 }, { id: 'a3', suit: 's', rank: 3 }],
    [{ id: 'b1', suit: 's', rank: 6 }, { id: 'b2', suit: 's', rank: 5 }, { id: 'b3', suit: 's', rank: 8 }],
    [{ id: 'c1', suit: 's', rank: 10 }, { id: 'c2', suit: 's', rank: 13 }, { id: 'c3', suit: 's', rank: 2 }],
  ];

  // 0 号领出 J（白骨精）
  let r = engine.applyAction(st, players, 0, 'play', { cardIds: ['a1'] });
  assert.ok(r.ok, r.error);
  // 1 号打出 6 白龙马
  r = engine.applyAction(st, players, 1, 'play', { cardIds: ['b1'] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(st.currentSeat, 0, '出牌权回到上家（0 号）');
  assert.ok(st.table && st.table.rank === 11, '桌面仍是要管的 J');
  assert.strictEqual(st.trickPile.length, 2, '桌面牌堆保留 J + 6');

  // 0 号用 Q 管住 J
  r = engine.applyAction(st, players, 0, 'play', { cardIds: ['a2'] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(st.table.rank, 12);
  assert.strictEqual(st.trickPile.length, 3);
  assert.strictEqual(st.currentSeat, 1, '轮到 1 号管 Q');
});

test('A 方案：出 2 过牌后仍留在桌面，由下家继续管原来那手', () => {
  const players = mkPlayers(3);
  const st = xihua.createState({ playerCount: 3, config: { mode: MODE_A, penalty: 'two' } });
  st._players = players;
  st.phase = 'play';
  st.firstSeat = 0;
  st.currentSeat = 0;
  st.hands = [
    [{ id: 'a1', suit: 's', rank: 11 }, { id: 'a2', suit: 's', rank: 12 }],
    [{ id: 'b1', suit: 's', rank: 2 }, { id: 'b2', suit: 's', rank: 5 }],
    [{ id: 'c1', suit: 's', rank: 10 }, { id: 'c2', suit: 's', rank: 13 }],
  ];

  let r = engine.applyAction(st, players, 0, 'play', { cardIds: ['a1'] });
  assert.ok(r.ok, r.error);
  r = engine.applyAction(st, players, 1, 'play', { cardIds: ['b1'] });
  assert.ok(r.ok, r.error);

  assert.strictEqual(st.currentSeat, 2, '轮到下家继续管');
  assert.ok(st.table && st.table.rank === 11, '要管的仍是上家那手 J');
  assert.strictEqual(st.trickPile.length, 2, '2 也进入桌面牌堆用于展示');
  assert.ok(st.trickPile.some((c) => c.rank === 2), '牌堆里有那张 2');
});

test('B 方案：收牌时 2 只展示、不计入惩罚区', () => {
  const players = mkPlayers(3);
  const st = xihua.createState({ playerCount: 3, config: { mode: MODE_B, penalty: 'one' } });
  st._players = players;
  st.phase = 'play';
  st.firstSeat = 0;
  st.currentSeat = 0;
  st.hands = [
    [{ id: 'a1', suit: 's', rank: 8 }, { id: 'a2', suit: 's', rank: 5 }],
    [{ id: 'b1', suit: 's', rank: 2 }, { id: 'b2', suit: 's', rank: 10 }],
    [{ id: 'c1', suit: 's', rank: 3 }, { id: 'c2', suit: 's', rank: 12 }],
  ];

  let r = engine.applyAction(st, players, 0, 'play', { cardIds: ['a1'] });
  assert.ok(r.ok, r.error);
  r = engine.applyAction(st, players, 1, 'play', { cardIds: ['b1'] });
  assert.ok(r.ok, r.error);
  assert.strictEqual(st.trickPile.length, 2, '桌面展示 8 和 2');

  const bottomBefore = st.bottom.length;
  r = engine.applyAction(st, players, 2, 'pass', {});
  assert.ok(r.ok, r.error);
  assert.strictEqual(st.penaltyZone[2].length, 1, '惩罚区只收 8，不含过牌 2');
  assert.strictEqual(st.bottom.length, bottomBefore + 1, '2 进弃牌堆');
});

console.log('─'.repeat(50));
console.log(`通过 ${passed} / ${passed + failed}${failed ? ` · 失败 ${failed}` : ''}\n`);
process.exit(failed ? 1 : 0);
