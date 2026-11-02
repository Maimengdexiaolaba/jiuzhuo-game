import { buildDeck, isJoker } from '../server/games/supermeng/cards.js';
import { evaluateHand, compareHands } from '../server/games/supermeng/rules.js';
import supermeng from '../server/games/supermeng/index.js';
import * as engine from '../server/games/supermeng/engine.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ ${name}\n    ${e.message}`);
  }
}

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

const cfg = (over = {}) => supermeng.normalizeConfig(over);

const C = (rank, suit = 's') => ({ id: `${suit}${rank}`, suit, rank });
const JOK = (big = false) => ({ id: big ? 'jokerb' : 'jokers', suit: 'joker', rank: big ? 16 : 15 });

console.log('── 牌型判定 ──');

test('天炸：大王+小王', () => {
  const h = evaluateHand(JOK(true), JOK(false), cfg());
  assert(h.key === 'bomb' && h.bombType === 'tian', '应为天炸');
});

test('真炸：两张同点', () => {
  const h = evaluateHand(C(7, 's'), C(7, 'h'), cfg());
  assert(h.key === 'bomb' && h.bombType === 'real' && h.rank === 7);
});

test('单癞假炸：王+10 点数 10', () => {
  const h = evaluateHand(JOK(false), C(10, 's'), cfg());
  assert(h.key === 'bomb' && h.bombType === 'fake' && h.rank === 10);
});

test('同花顺：同色 5、6', () => {
  const h = evaluateHand(C(5, 's'), C(6, 's'), cfg());
  assert(h.key === 'flushStraight', '应为同花顺，得到 ' + h.key);
});

test('顺子：不同色 5、7（隔一张）', () => {
  const h = evaluateHand(C(5, 's'), C(7, 'h'), cfg());
  assert(h.key === 'straight' && h.rank === 7);
});

test('金花：同色 2、9', () => {
  const h = evaluateHand(C(2, 's'), C(9, 's'), cfg());
  assert(h.key === 'flush' && h.rank === 9);
});

test('单牌：不同色 7、K → 最大 K', () => {
  const h = evaluateHand(C(7, 's'), C(13, 'h'), cfg());
  assert(h.key === 'single' && h.rank === 13);
});

test('235：不同色 2、5', () => {
  const h = evaluateHand(C(2, 's'), C(5, 'h'), cfg());
  assert(h.key === 'bomb235');
});

test('235 同色 2、5 为金花', () => {
  const h = evaluateHand(C(2, 's'), C(5, 's'), cfg());
  assert(h.key === 'flush');
});

test('A、2 开 ace23 时为顺子（顶 3）', () => {
  const h = evaluateHand(C(14, 's'), C(2, 'h'), cfg({ ace23: true }));
  assert(h.key === 'straight' && h.rank === 3);
});

test('A、3 开 ace23 时为顺子', () => {
  const h = evaluateHand(C(14, 's'), C(3, 'h'), cfg({ ace23: true }));
  assert(h.key === 'straight' && h.rank === 3);
});

test('A、K 为顺子（顶 A）', () => {
  const h = evaluateHand(C(14, 's'), C(13, 'h'), cfg({ ace23: false }));
  assert(h.key === 'straight' && h.rank === 14);
});

test('关 ace23 时 A、2 为单牌', () => {
  const h = evaluateHand(C(14, 's'), C(2, 'h'), cfg({ ace23: false }));
  assert(h.key === 'single');
});

console.log('── 比较 ──');

test('天炸 > 真炸 AAA', () => {
  const a = evaluateHand(JOK(true), JOK(false), cfg());
  const b = evaluateHand(C(14, 's'), C(14, 'h'), cfg());
  assert(compareHands(a, b, cfg()) === 1);
});

test('真炸 777 > 假炸 王+A（真炸>假炸）', () => {
  const a = evaluateHand(C(7, 's'), C(7, 'h'), cfg({ bombRule: 'realFirst' }));
  const b = evaluateHand(JOK(false), C(14, 's'), cfg({ bombRule: 'realFirst' }));
  assert(compareHands(a, b, cfg({ bombRule: 'realFirst' })) === 1);
});

test('炸弹比点数：假炸 王+A > 真炸 777', () => {
  const a = evaluateHand(C(7, 's'), C(7, 'h'), cfg({ bombRule: 'byPoint' }));
  const b = evaluateHand(JOK(false), C(14, 's'), cfg({ bombRule: 'byPoint' }));
  assert(compareHands(a, b, cfg({ bombRule: 'byPoint' })) === -1);
});

test('假炸 王+10 > 王+9', () => {
  const a = evaluateHand(JOK(false), C(10, 's'), cfg());
  const b = evaluateHand(JOK(false), C(9, 's'), cfg());
  assert(compareHands(a, b, cfg()) === 1);
});

test('235 吃真炸', () => {
  const a = evaluateHand(C(2, 's'), C(5, 'h'), cfg());
  const b = evaluateHand(C(7, 's'), C(7, 'h'), cfg());
  assert(compareHands(a, b, cfg()) === 1);
});

test('235 吃单癞假炸', () => {
  const a = evaluateHand(C(2, 's'), C(5, 'h'), cfg());
  const b = evaluateHand(JOK(false), C(10, 's'), cfg());
  assert(compareHands(a, b, cfg()) === 1);
});

test('235 不吃天炸', () => {
  const a = evaluateHand(C(2, 's'), C(5, 'h'), cfg());
  const b = evaluateHand(JOK(true), JOK(false), cfg());
  assert(compareHands(a, b, cfg()) === -1);
});

test('235 遇单牌 A 时为单牌（A 大）', () => {
  const a = evaluateHand(C(2, 's'), C(5, 'h'), cfg());
  const b = evaluateHand(C(14, 's'), C(9, 'h'), cfg());
  assert(compareHands(a, b, cfg()) === -1);
});

test('顺子 > 金花（默认）', () => {
  const a = evaluateHand(C(5, 's'), C(6, 'h'), cfg({ orderRule: 'straightFirst' }));
  const b = evaluateHand(C(2, 's'), C(9, 's'), cfg({ orderRule: 'straightFirst' }));
  assert(compareHands(a, b, cfg({ orderRule: 'straightFirst' })) === 1);
});

test('金花 > 顺子（flushFirst）', () => {
  const a = evaluateHand(C(5, 's'), C(6, 'h'), cfg({ orderRule: 'flushFirst' }));
  const b = evaluateHand(C(2, 's'), C(9, 's'), cfg({ orderRule: 'flushFirst' }));
  assert(compareHands(a, b, cfg({ orderRule: 'flushFirst' })) === -1);
});

test('单牌只比最大张：A、4 vs A、5 → 平', () => {
  const a = evaluateHand(C(14, 's'), C(4, 'h'), cfg());
  const b = evaluateHand(C(14, 'h'), C(5, 's'), cfg());
  assert(compareHands(a, b, cfg()) === 0);
});

console.log('── 引擎流程 ──');

function mkPlayers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, seat: i, isBot: true }));
}

test('4 人局自动跑到结算并生成明细', () => {
  const players = mkPlayers(4);
  const st = supermeng.createState({ playerCount: 4, config: { allowBlind: true, dealerChange: 'once', betMax: 3 } });
  st._players = players;
  let guard = 0;
  while (st.phase !== 'settle' && guard < 500) {
    guard += 1;
    const jobs = engine.pendingBotActions(st, () => true);
    if (!jobs.length) break;
    const j = jobs[0];
    const r = engine.applyAction(st, players, j.seat, j.type, j.payload);
    if (!r.ok) throw new Error(`step fail: ${j.type} -> ${r.error}`);
  }
  assert(st.phase === 'settle', `应到结算，实际 ${st.phase} (guard ${guard})`);
  assert(Array.isArray(st.results.rows) && st.results.rows.length >= 1, '结算至少开了一家');
  assert(st.results.dealer.won >= 0 && st.results.dealer.lost >= 0, '胜负杯数非负');
});

test('多种配置多人数自动对局无死锁', () => {
  const configs = [
    { withJoker: true, orderRule: 'straightFirst', bombRule: 'realFirst', eatBomb235: true, allowBlind: true, dealerChange: 'none', betMax: 3 },
    { withJoker: false, orderRule: 'flushFirst', eatBomb235: true, allowBlind: false, dealerChange: 'twice', betMax: 2 },
    { withJoker: true, bombRule: 'byPoint', eatBomb235: false, allowBlind: false, dealerChange: 'none', betMax: 1 },
  ];
  for (const cfgv of configs) {
    for (let n = 2; n <= 8; n += 1) {
      const players = mkPlayers(n);
      const st = supermeng.createState({ playerCount: n, config: cfgv });
      st._players = players;
      let guard = 0;
      while (st.phase !== 'settle' && guard < 2000) {
        guard += 1;
        const jobs = engine.pendingBotActions(st, () => true);
        if (!jobs.length) throw new Error(`deadlock cfg=${JSON.stringify(cfgv)} n=${n} phase=${st.phase}`);
        const j = jobs[0];
        const r = engine.applyAction(st, players, j.seat, j.type, j.payload);
        if (!r.ok) throw new Error(`fail n=${n}: ${j.type} -> ${r.error}`);
      }
      assert(st.phase === 'settle', `n=${n} 应结算`);
    }
  }
});

test('干2（g2）：叫酒上限保留 g2，不归一成 3', () => {
  assert(cfg({ betMax: 'g2' }).betMax === 'g2', 'normalizeConfig 应保留 g2');
  // engine 内部 normalizeConfig 也必须保留 g2（此前 bug：被归一成 3）
  assert(engine.normalizeConfig({ betMax: 'g2' }).betMax === 'g2', 'engine.normalizeConfig 应保留 g2');
});

test('干2：全场默认 2 杯，跳过叫酒直接进开牌', () => {
  const players = mkPlayers(4);
  const st = supermeng.createState({ playerCount: 4, config: { betMax: 'g2', dealerChange: 'none', allowBlind: false } });
  st._players = players;
  assert(st.phase === 'open', `干2应直接进开牌，实际 ${st.phase}`);
  for (let s = 0; s < 4; s += 1) {
    if (s !== st.dealerSeat) assert(st.bets[s] === 2, `闲家 ${s} 应默认 2 杯，实际 ${st.bets[s]}`);
  }
});

test('闲家服了（fold）必输，不与庄家比牌', () => {
  const players = mkPlayers(3);
  // 庄家 seat 0，闲家 seat 1、2；关闭闷牌、不换牌，快速到开牌
  const st = supermeng.createState({ playerCount: 3, config: { allowBlind: false, dealerChange: 'none', betMax: 3 } });
  st._players = players;
  let guard = 0;
  // 手动走：闲家依次叫酒
  while (st.phase === 'bet' && guard < 10) {
    guard += 1;
    const r = engine.applyAction(st, players, st.currentSeat, 'bet', { cups: 1 });
    if (!r.ok) throw new Error(r.error);
  }
  assert(st.phase === 'open', `应进开牌，实际 ${st.phase}`);
  // 庄家开闲家 1
  let r = engine.applyAction(st, players, st.dealerSeat, 'open', { seat: 1 });
  assert(r.ok, r.error);
  // 闲家 1 服了
  r = engine.applyAction(st, players, 1, 'fold', {});
  assert(r.ok, r.error);
  // 结束开牌 → 结算
  r = engine.applyAction(st, players, st.dealerSeat, 'stopOpen', {});
  assert(r.ok, r.error);
  const row = st.results.rows.find((x) => x.seat === 1);
  assert(row && row.outcome === 'fold', '服了的闲家 outcome 应为 fold');
  assert(row.seatCups === row.bet, '服了应只喝所押杯，不翻倍');
  assert(row.lostByDealer === 0, '服了庄家不赔');
});

test('所有模式庄家至少开一家（换牌模式也不能一家不开）', () => {
  // 换牌模式（dealerChange='once'）：庄家试图 0 家结束应被拒绝
  const players = mkPlayers(3);
  const st = supermeng.createState({ playerCount: 3, config: { allowBlind: false, dealerChange: 'once', betMax: 3 } });
  st._players = players;
  let guard = 0;
  // 若进入换牌阶段，庄家跳过换牌
  while (st.phase === 'dealer_change' && guard < 3) {
    guard += 1;
    const r = engine.applyAction(st, players, st.dealerSeat, 'skipChange', {});
    if (!r.ok) throw new Error(r.error);
  }
  guard = 0;
  while (st.phase === 'bet' && guard < 10) {
    guard += 1;
    const r = engine.applyAction(st, players, st.currentSeat, 'bet', { cups: 1 });
    if (!r.ok) throw new Error(r.error);
  }
  assert(st.phase === 'open', `应进开牌，实际 ${st.phase}`);
  // 庄家 0 家直接结束开牌 → 应被拒绝
  const r = engine.applyAction(st, players, st.dealerSeat, 'stopOpen', {});
  assert(!r.ok, '换牌模式 0 家结束开牌应被拒绝');
  assert(r.error === '庄家至少开一家', `错误信息应为「庄家至少开一家」，实际 ${r.error}`);
});

test('大回合：打完整副牌触发移庄', () => {
  const players = mkPlayers(3);
  const st = supermeng.createState({ playerCount: 3, config: { withJoker: false, dealerChange: 'none', betMax: 1 } });
  st._players = players;
  let guard = 0;
  let bigEnd = false;
  while (guard < 20000) {
    guard += 1;
    if (st.phase === 'big_end') { bigEnd = true; break; }
    const jobs = engine.pendingBotActions(st, () => true);
    if (!jobs.length) break;
    const j = jobs[0];
    const r = engine.applyAction(st, players, j.seat, j.type, j.payload);
    if (!r.ok) throw new Error(`${j.type} -> ${r.error}`);
  }
  assert(bigEnd, '应触发本庄统计');
  // 移庄并重设规则
  const r = engine.applyAction(st, players, 0, 'pickDealer', { seat: 1 });
  assert(r.ok, r.error);
  const r2 = engine.applyAction(st, players, 1, 'startBigRound', { config: { betMax: 2 } });
  assert(r2.ok, r2.error);
  assert(st.phase === 'bet' || st.phase === 'blind', '移庄后重新开局');
  assert(st.dealerSeat === 1, '新庄家就位');
  assert(st.config.betMax === 2, '规则已更新');
});

console.log(`\n通过 ${passed} / ${passed + failed}${failed ? ` · 失败 ${failed}` : ''}`);
process.exit(failed ? 1 : 0);
