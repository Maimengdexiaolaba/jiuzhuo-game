import { RANK_LABEL, cardPoint } from './cards.js';

/**
 * 牌型等级（数值越大越强）
 * 5 幺鸡对  —— 关闭二八最大时为全场最大
 * 4 二八杠  —— 仅在开启「二八最大」时成立，为全场最大
 * 3 对子    —— 两张完全相同的牌，不计点数，显示为「九筒对」
 * 2 点数    —— 相加取个位，0 点（鳖十）最小
 */
export const TIER = {
  BIRD_PAIR: 5,
  ERBA: 4,
  PAIR: 3,
  POINT: 2,
};

export const ERBA_MAX_TIER = 6;

/**
 * 评估两手牌
 * 点数规则：幺鸡 0 点、一筒~九筒 1~9 点，两张相加取个位。
 * 对子类牌型（幺鸡对 / 对子 / 二八杠）不计点数，直接比牌型。
 * @param {Array<{r:number}>} cards 两张牌
 * @param {{erbaMax:boolean}} opts  玩法选项
 */
export function evaluateHand(cards, opts = {}) {
  const [a, b] = cards.map((c) => c.r).sort((x, y) => x - y);
  const point = (cardPoint({ r: a }) + cardPoint({ r: b })) % 10;

  if (a === 0 && b === 0) {
    return {
      key: 'birdPair',
      name: '幺鸡对',
      tier: TIER.BIRD_PAIR,
      point,
      pairRank: 0,
      isPair: true,
      showPoints: false,
      detail: opts.erbaMax
        ? '两张幺鸡，仅次于二八杠'
        : '两张幺鸡，全场最大牌型',
    };
  }

  if (opts.erbaMax && a === 2 && b === 8) {
    return {
      key: 'erba',
      name: '二八杠',
      tier: ERBA_MAX_TIER,
      point,
      pairRank: 0,
      isPair: false,
      showPoints: false,
      detail: '二筒 + 八筒，全场最大牌型',
    };
  }

  if (a === b) {
    return {
      key: 'pair',
      name: `${RANK_LABEL[a]}对`,
      tier: TIER.PAIR,
      point,
      pairRank: a,
      isPair: true,
      showPoints: false,
      detail: `两张${RANK_LABEL[a]}，不计点数，胜结算杯数翻倍`,
    };
  }

  return {
    key: 'point',
    name: point === 0 ? '鳖十' : '普通点数',
    tier: TIER.POINT,
    point,
    pairRank: 0,
    isPair: false,
    showPoints: true,
    detail: point === 0
      ? `${cardPoint({ r: a })} + ${cardPoint({ r: b })}，相加为十，最小点数`
      : `${cardPoint({ r: a })} + ${cardPoint({ r: b })} 取个位`,
  };
}

/**
 * 比较两手牌：> 0 表示 x 胜，< 0 表示 y 胜，0 表示完全相同
 * 平局时由调用方按「庄家大于闲家」处理。
 */
export function compareHands(x, y) {
  if (x.tier !== y.tier) return x.tier > y.tier ? 1 : -1;
  if (x.tier === TIER.PAIR) return Math.sign(x.pairRank - y.pairRank);
  if (x.tier === TIER.POINT) return Math.sign(x.point - y.point);
  return 0;
}

/**
 * 单笔结算
 * 闲家押注 bet 杯；若闲家牌型为对子（含幺鸡对），本笔杯数翻倍。
 * 闲家胜 -> 庄家喝 amount 杯；闲家负/平 -> 闲家喝 amount 杯。
 */
export function settleAgainstDealer(dealerHand, playerHand, bet) {
  const cmp = compareHands(playerHand, dealerHand);
  const multiplier = playerHand.isPair ? 2 : 1;
  const amount = Math.max(0, Math.round(bet)) * multiplier;
  if (cmp > 0) {
    return { outcome: 'win', multiplier, amount, note: playerHand.isPair ? '对子翻倍' : '' };
  }
  if (cmp === 0) {
    return { outcome: 'dealerWin', multiplier, amount, note: '点数相同，庄家胜' };
  }
  return { outcome: 'lose', multiplier, amount, note: playerHand.isPair ? '对子翻倍' : '' };
}

export function describeHand(hand, opts) {
  return evaluateHand(hand, opts);
}
