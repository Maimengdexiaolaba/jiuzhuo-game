import assert from 'node:assert';
import { buildDeck, diceToSeat, rollTwoDice, cardPoint, DECK_SIZE } from '../server/games/tuibingzi/cards.js';
import { evaluateHand, compareHands, settleAgainstDealer } from '../server/games/tuibingzi/rules.js';
import * as engine from '../server/games/tuibingzi/engine.js';

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    results.push(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    results.push(`  ✗ ${name}\n      ${err.message}`);
  }
}

const card = (r, i = 0) => ({ id: `c${r}_${i}`, r });
const hand = (a, b) => [card(a, 0), card(b, 1)];

/* ---------------- 牌组 ---------------- */

test('牌组共 40 张', () => {
  const deck = buildDeck();
  assert.strictEqual(deck.length, DECK_SIZE);
  assert.strictEqual(deck.filter((c) => c.r === 0).length, 4);
  for (let r = 1; r <= 9; r += 1) {
    assert.strictEqual(deck.filter((c) => c.r === r).length, 4, `筒${r}应为4张`);
  }
  const ids = new Set(deck.map((c) => c.id));
  assert.strictEqual(ids.size, 40, '牌 id 必须唯一');
});

/* ---------------- 骰子选人 ---------------- */

test('4人局：点数和 1/5/9 命中庄家', () => {
  [1, 5, 9].forEach((t) => assert.strictEqual(diceToSeat(t, 4), 0, `total=${t}`));
  assert.strictEqual(diceToSeat(2, 4), 1);
  assert.strictEqual(diceToSeat(4, 4), 3);
  assert.strictEqual(diceToSeat(6, 4), 1);
});

test('5人局：点数和 1/6/10 命中庄家', () => {
  [1, 6, 10].forEach((t) => assert.strictEqual(diceToSeat(t, 5), 0, `total=${t}`));
  assert.strictEqual(diceToSeat(3, 5), 2);
});

test('6人局：点数和 1/7/11 命中庄家', () => {
  [1, 7, 11].forEach((t) => assert.strictEqual(diceToSeat(t, 6), 0, `total=${t}`));
  assert.strictEqual(diceToSeat(9, 6), 2);
});

test('两枚骰子点数范围 2~12', () => {
  for (let i = 0; i < 2000; i += 1) {
    const { d1, d2, total } = rollTwoDice();
    assert.ok(d1 >= 1 && d1 <= 6);
    assert.ok(d2 >= 1 && d2 <= 6);
    assert.strictEqual(total, d1 + d2);
  }
});

/* ---------------- 牌型 ---------------- */

test('一对幺鸡为全场最大（关闭二八最大）', () => {
  const bird = evaluateHand(hand(0, 0), { erbaMax: false });
  const nine = evaluateHand(hand(9, 9), { erbaMax: false });
  assert.strictEqual(bird.key, 'birdPair');
  assert.strictEqual(compareHands(bird, nine), 1, '幺鸡对应大于九筒对');
});

test('对子大于普通点数', () => {
  const pair = evaluateHand(hand(2, 2), { erbaMax: false });
  const nine = evaluateHand(hand(9, 9), { erbaMax: false });
  const top = evaluateHand(hand(4, 5), { erbaMax: false }); // 9 点
  assert.strictEqual(top.point, 9);
  assert.strictEqual(compareHands(pair, top), 1, '对子 > 9点');
});

test('对子之间比大小', () => {
  const p9 = evaluateHand(hand(9, 9), { erbaMax: false });
  const p3 = evaluateHand(hand(3, 3), { erbaMax: false });
  assert.strictEqual(compareHands(p9, p3), 1);
});

test('点数相加取个位，鳖十为 0 点最小', () => {
  assert.strictEqual(evaluateHand(hand(4, 6), { erbaMax: false }).point, 0);
  assert.strictEqual(evaluateHand(hand(7, 3), { erbaMax: false }).point, 0);
  const bie = evaluateHand(hand(4, 6), { erbaMax: false });
  const one = evaluateHand(hand(1, 0), { erbaMax: false }); // 一筒1点 + 幺鸡0点
  assert.strictEqual(one.point, 1);
  assert.strictEqual(compareHands(one, bie), 1, '1点 > 鳖十');
});

test('幺鸡算 0 点，一筒算 1 点', () => {
  assert.strictEqual(cardPoint(card(0)), 0, '幺鸡 0 点');
  assert.strictEqual(cardPoint(card(1)), 1, '一筒 1 点');

  const birdPlusOne = evaluateHand(hand(0, 1), { erbaMax: false });
  assert.strictEqual(birdPlusOne.key, 'point');
  assert.strictEqual(birdPlusOne.point, 1, '幺鸡+一筒 = 1 点');

  const birdPlusNine = evaluateHand(hand(0, 9), { erbaMax: false });
  assert.strictEqual(birdPlusNine.point, 9, '幺鸡+九筒 = 9 点');

  // 幺鸡 0 点，所以 幺鸡+一筒(1点) 小于 二筒+九筒(1点)? 相同则平
  const twoNine = evaluateHand(hand(2, 9), { erbaMax: false });
  assert.strictEqual(compareHands(birdPlusOne, twoNine), 0, '同为 1 点应平');
});

test('对子不计点数，显示为「X对」', () => {
  const p9 = evaluateHand(hand(9, 9), { erbaMax: false });
  assert.strictEqual(p9.key, 'pair');
  assert.strictEqual(p9.name, '九筒对');
  assert.strictEqual(p9.showPoints, false, '对子不显示点数');

  const p3 = evaluateHand(hand(3, 3), { erbaMax: false });
  assert.strictEqual(p3.name, '三筒对');

  const birdPair = evaluateHand(hand(0, 0), { erbaMax: false });
  assert.strictEqual(birdPair.name, '幺鸡对');
  assert.strictEqual(birdPair.showPoints, false);

  const pointHand = evaluateHand(hand(3, 5), { erbaMax: false });
  assert.strictEqual(pointHand.showPoints, true, '普通点数需要显示点数');
});

test('关闭二八最大时，2+8 仅为普通 0 点', () => {
  const h = evaluateHand(hand(2, 8), { erbaMax: false });
  assert.strictEqual(h.key, 'point');
  assert.strictEqual(h.point, 0);
  assert.strictEqual(h.tier, 2);
});

test('开启二八最大时，二八杠为全场最大', () => {
  const erba = evaluateHand(hand(2, 8), { erbaMax: true });
  const bird = evaluateHand(hand(0, 0), { erbaMax: true });
  assert.strictEqual(erba.key, 'erba');
  assert.strictEqual(compareHands(erba, bird), 1, '二八杠 > 一对幺鸡');
});

test('牌型完全相同时判平（由庄家胜）', () => {
  const a = evaluateHand(hand(3, 5), { erbaMax: false });
  const b = evaluateHand(hand(4, 4), { erbaMax: false }); // 也是 8 点对子? 4+4 是对子
  assert.strictEqual(compareHands(a, b), -1, '对子应更大');

  const x = evaluateHand(hand(3, 5), { erbaMax: false });
  const y = evaluateHand(hand(1, 7), { erbaMax: false });
  assert.strictEqual(compareHands(x, y), 0, '同为8点应平');
});

/* ---------------- 结算 ---------------- */

test('对子翻倍：闲家押2杯一对饼胜庄家 -> 庄家喝4杯', () => {
  const dealer = evaluateHand(hand(4, 5), { erbaMax: false }); // 9点
  const player = evaluateHand(hand(9, 9), { erbaMax: false });
  const s = settleAgainstDealer(dealer, player, 2);
  assert.strictEqual(s.outcome, 'win');
  assert.strictEqual(s.multiplier, 2);
  assert.strictEqual(s.amount, 4);
});

test('需求示例：庄9点 / 闲1八点押2 / 闲2一对押2 / 闲3一点押3', () => {
  const dealer = evaluateHand(hand(4, 5), { erbaMax: false }); // 9点
  const p1 = evaluateHand(hand(3, 5), { erbaMax: false }); // 8点
  const p2 = evaluateHand(hand(6, 6), { erbaMax: false }); // 一对
  const p3 = evaluateHand(hand(5, 6), { erbaMax: false }); // 1点

  const s1 = settleAgainstDealer(dealer, p1, 2);
  const s2 = settleAgainstDealer(dealer, p2, 2);
  const s3 = settleAgainstDealer(dealer, p3, 3);

  assert.strictEqual(s1.outcome, 'lose');
  assert.strictEqual(s1.amount, 2);
  assert.strictEqual(s2.outcome, 'win');
  assert.strictEqual(s2.amount, 4);
  assert.strictEqual(s3.outcome, 'lose');
  assert.strictEqual(s3.amount, 3);

  const dealerWon = s1.amount + s3.amount; // 5
  const dealerLost = s2.amount; // 4
  assert.strictEqual(dealerWon, 5);
  assert.strictEqual(dealerLost, 4);
});

test('平局时庄家胜，闲家输押注杯数', () => {
  const dealer = evaluateHand(hand(3, 5), { erbaMax: false }); // 8
  const player = evaluateHand(hand(1, 7), { erbaMax: false }); // 8
  const s = settleAgainstDealer(dealer, player, 3);
  assert.strictEqual(s.outcome, 'dealerWin');
  assert.strictEqual(s.amount, 3);
});

/* ---------------- 阶段机 ---------------- */

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i === 0 ? 'host' : `p${i}`,
    name: i === 0 ? '房主' : `玩家${i}`,
    seat: i,
    isBot: false,
  }));
}

test('完整一局流程必须全部手动推进', () => {
  const players = makePlayers(4);
  const st = engine.createState({ playerCount: 4, config: { erbaMax: false } });

  assert.strictEqual(st.phase, 'shuffle');

  // 非庄家不能洗牌
  assert.ok(!engine.applyAction(st, players, 1, 'shuffle').ok);
  assert.ok(engine.applyAction(st, players, 0, 'shuffle').ok);
  assert.strictEqual(st.phase, 'cut_dice');
  assert.strictEqual(st.wall.length, 40);

  assert.ok(engine.applyAction(st, players, 0, 'rollCutDice').ok);
  assert.ok(['cut_choice', 'bet'].includes(st.phase), '切牌阶段应跳转到 bet 或 cut_choice');

  let guard = 0;
  while (st.phase === 'cut_choice' && guard < 5) {
    const seat = st.cut.bySeat;
    assert.ok(engine.applyAction(st, players, seat, 'cut').ok);
    guard += 1;
  }
  assert.strictEqual(st.phase, 'bet');

  // 庄家不能押酒
  assert.ok(!engine.applyAction(st, players, 0, 'bet', { cups: 1 }).ok);
  for (let s = 1; s < 4; s += 1) {
    assert.ok(engine.applyAction(st, players, s, 'bet', { cups: (s % 3) + 1 }).ok);
  }
  assert.strictEqual(st.phase, 'deal_dice');

  assert.ok(engine.applyAction(st, players, 0, 'rollDealDice').ok);
  assert.strictEqual(st.phase, 'reveal_dealer');
  assert.strictEqual(st.wall.length, 40 - 8);
  st.hands.forEach((h) => assert.strictEqual(h.length, 2));

  // 未到阶段不能提前亮牌
  assert.ok(!engine.applyAction(st, players, 1, 'revealSelf').ok);
  assert.ok(engine.applyAction(st, players, 0, 'revealDealer').ok);
  assert.strictEqual(st.phase, 'reveal_players');

  assert.ok(!engine.applyAction(st, players, 0, 'nextRound').ok, '未结算不能开始下一局');
  for (let s = 1; s < 4; s += 1) {
    assert.ok(engine.applyAction(st, players, s, 'revealSelf').ok);
  }
  assert.strictEqual(st.phase, 'settle');
  assert.ok(st.results, '应生成结算数据');
  assert.strictEqual(st.results.rows.length, 3);
  assert.ok(st.results.dealerRow);

  // 只有庄家能开下一局
  assert.ok(!engine.applyAction(st, players, 1, 'nextRound').ok);
  assert.ok(engine.applyAction(st, players, 0, 'nextRound').ok);
  assert.strictEqual(st.phase, 'bet', '新一轮直接从押酒开始');
  assert.strictEqual(st.roundNo, 2);
});

test('牌墙摸完进入大回合结算，并支持移庄', () => {
  const players = makePlayers(4);
  const st = engine.createState({ playerCount: 4, config: { erbaMax: false } });
  engine.applyAction(st, players, 0, 'shuffle');

  let safety = 0;
  while (st.phase !== 'big_end' && safety < 40) {
    safety += 1;
    if (st.phase === 'cut_dice') engine.applyAction(st, players, 0, 'rollCutDice');
    else if (st.phase === 'cut_choice') engine.applyAction(st, players, st.cut.bySeat, 'skipCut');
    else if (st.phase === 'bet') {
      for (let s = 1; s < 4; s += 1) {
        if (!st.betConfirmed[s]) engine.applyAction(st, players, s, 'bet', { cups: 2 });
      }
    } else if (st.phase === 'deal_dice') engine.applyAction(st, players, 0, 'rollDealDice');
    else if (st.phase === 'reveal_dealer') engine.applyAction(st, players, 0, 'revealDealer');
    else if (st.phase === 'reveal_players') {
      for (let s = 1; s < 4; s += 1) {
        if (!st.revealed[s]) engine.applyAction(st, players, s, 'revealSelf');
      }
    } else if (st.phase === 'settle') engine.applyAction(st, players, 0, 'nextRound');
  }

  assert.strictEqual(st.phase, 'big_end', '4人局 40 张牌应恰好打 5 局');
  assert.strictEqual(st.history.length, 5);
  assert.strictEqual(st.wall.length, 0);

  // 全部关闭统计面板 -> 移庄
  for (let s = 0; s < 4; s += 1) engine.applyAction(st, players, s, 'closeSummary');
  assert.strictEqual(st.phase, 'dealer_pick');

  assert.ok(!engine.applyAction(st, players, 1, 'pickDealer', { seat: 2 }).ok, '只有庄家能移庄');
  assert.ok(engine.applyAction(st, players, 0, 'pickDealer', { seat: 2 }).ok);
  assert.strictEqual(st.dealerSeat, 2);
  assert.strictEqual(st.phase, 'shuffle');
  assert.strictEqual(st.bigRound, 2);
});

test('6人局牌墙不足时提前结束大回合', () => {
  const players = makePlayers(6);
  const st = engine.createState({ playerCount: 6, config: { erbaMax: false } });
  engine.applyAction(st, players, 0, 'shuffle');

  let safety = 0;
  while (st.phase !== 'big_end' && safety < 60) {
    safety += 1;
    if (st.phase === 'cut_dice') engine.applyAction(st, players, 0, 'rollCutDice');
    else if (st.phase === 'cut_choice') engine.applyAction(st, players, st.cut.bySeat, 'skipCut');
    else if (st.phase === 'bet') {
      for (let s = 1; s < 6; s += 1) if (!st.betConfirmed[s]) engine.applyAction(st, players, s, 'bet', { cups: 1 });
    } else if (st.phase === 'deal_dice') engine.applyAction(st, players, 0, 'rollDealDice');
    else if (st.phase === 'reveal_dealer') engine.applyAction(st, players, 0, 'revealDealer');
    else if (st.phase === 'reveal_players') {
      for (let s = 1; s < 6; s += 1) if (!st.revealed[s]) engine.applyAction(st, players, s, 'revealSelf');
    } else if (st.phase === 'settle') engine.applyAction(st, players, 0, 'nextRound');
  }

  assert.strictEqual(st.phase, 'big_end');
  assert.strictEqual(st.wall.length, 4, '6人局 3 局用 36 张，剩 4 张');
  assert.strictEqual(st.history.length, 3);
});

test('大回合统计等于各局累计', () => {
  const players = makePlayers(3);
  const st = engine.createState({ playerCount: 3, config: { erbaMax: false } });
  engine.applyAction(st, players, 0, 'shuffle');

  let sumWon = 0;
  let sumLost = 0;
  let safety = 0;
  while (st.phase !== 'big_end' && safety < 60) {
    safety += 1;
    if (st.phase === 'cut_dice') engine.applyAction(st, players, 0, 'rollCutDice');
    else if (st.phase === 'cut_choice') engine.applyAction(st, players, st.cut.bySeat, 'skipCut');
    else if (st.phase === 'bet') {
      for (let s = 1; s < 3; s += 1) if (!st.betConfirmed[s]) engine.applyAction(st, players, s, 'bet', { cups: 2 });
    } else if (st.phase === 'deal_dice') engine.applyAction(st, players, 0, 'rollDealDice');
    else if (st.phase === 'reveal_dealer') engine.applyAction(st, players, 0, 'revealDealer');
    else if (st.phase === 'reveal_players') {
      for (let s = 1; s < 3; s += 1) if (!st.revealed[s]) engine.applyAction(st, players, s, 'revealSelf');
    } else if (st.phase === 'settle') {
      sumWon += st.results.dealer.won;
      sumLost += st.results.dealer.lost;
      engine.applyAction(st, players, 0, 'nextRound');
    }
  }

  const dealerTotal = st.bigTotals[0];
  assert.strictEqual(dealerTotal.won, sumWon);
  assert.strictEqual(dealerTotal.lost, sumLost);

  // 所有座位胜杯总和 == 所有座位负杯总和（零和）
  const totalWon = st.bigTotals.reduce((a, t) => a + t.won, 0);
  const totalLost = st.bigTotals.reduce((a, t) => a + t.lost, 0);
  assert.strictEqual(totalWon, totalLost, '全场胜杯总数应等于负杯总数');
});

/* ---------------- 输出 ---------------- */

console.log('\n推饼子引擎自测\n' + '─'.repeat(46));
console.log(results.join('\n'));
console.log('─'.repeat(46));
console.log(`通过 ${passed} / ${passed + failed}${failed ? ` · 失败 ${failed}` : ''}\n`);

if (failed > 0) process.exit(1);
