/**
 * 纸牌西游记 · 牌组定义
 *
 * A 方案（54 张）：标准扑克 52 张 + 大小王
 *   3=沙僧 5=悟空 6=白龙马 8=八戒 10=唐僧 小王=菩萨 大王=如来
 *   A/4/7/9/J/Q/K = 妖精；2 = 过牌
 *
 * B 方案（36 张）：2/3/5/6/8/10/J/Q/K 各 4 张
 *   13=大妖 12=中妖 11=小妖 10=唐僧 5=悟空 8=八戒 3=沙僧
 *   2 = 过牌；6 = 白龙马（上家出牌）
 */

export const MODE_A = 'a54';
export const MODE_B = 'b36';

export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_TEXT = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAME = { s: '黑桃', h: '红桃', d: '方块', c: '梅花' };

export const RANK_TEXT = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '小王', 16: '大王',
};

/** B 方案使用的点数 */
export const B_RANKS = [2, 3, 5, 6, 8, 10, 11, 12, 13];

/** A 方案：仙界（含大小王、唐僧与三徒弟 + 白龙马） */
export const A_IMMORTAL_POWER = { 16: 100, 15: 90, 10: 70, 5: 60, 8: 50, 3: 40, 6: 30 };
/** A 方案：妖界 */
export const A_DEMON_POWER = { 14: 70, 13: 60, 12: 50, 11: 40, 9: 30, 7: 20, 4: 10 };

export const A_ROLE_NAME = {
  16: '如来', 15: '观音', 10: '唐僧', 5: '悟空', 8: '八戒', 3: '沙僧', 6: '白龙马',
  14: '金翅大鹏', 13: '红孩儿', 12: '铁扇公主', 11: '白骨精', 9: '牛魔王', 7: '蜘蛛精', 4: '小钻风',
  2: '筋斗云',
};

/** B 方案：组别与组内序号 */
export const B_GROUP = {
  13: 'demon', 12: 'demon', 11: 'demon',
  10: 'monk',
  5: 'disciple', 8: 'disciple', 3: 'disciple',
  2: 'pass',
  6: 'special',
};
export const B_POWER = { 13: 3, 12: 2, 11: 1, 10: 1, 5: 3, 8: 2, 3: 1 };
export const B_ROLE_NAME = {
  13: '红孩儿', 12: '铁扇公主', 11: '白骨精',
  10: '唐僧', 5: '悟空', 8: '八戒', 3: '沙僧',
  2: '筋斗云', 6: '白龙马',
};
/** B 方案里妖的三档叫法，用于规则文案 */
export const B_DEMON_TIER = { 13: '大妖', 12: '中妖', 11: '小妖' };

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildDeckA() {
  const deck = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r += 1) {
      deck.push({ id: `${s}${r}`, suit: s, rank: r });
    }
  }
  deck.push({ id: 'joker_s', suit: 'joker', rank: 15 });
  deck.push({ id: 'joker_b', suit: 'joker', rank: 16 });
  return deck;
}

export function buildDeckB() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of B_RANKS) {
      deck.push({ id: `${s}${r}`, suit: s, rank: r });
    }
  }
  return deck;
}

export function buildDeck(mode) {
  return mode === MODE_B ? buildDeckB() : buildDeckA();
}

export function deckSize(mode) {
  return mode === MODE_B ? 36 : 54;
}

/** A 方案阵营 */
export function sideOfA(rank) {
  if (rank === 2) return 'pass';
  if (A_IMMORTAL_POWER[rank] !== undefined) return 'immortal';
  if (A_DEMON_POWER[rank] !== undefined) return 'demon';
  return 'other';
}

/** 牌面角色信息，供前端展示 */
export function cardMeta(mode) {
  const meta = {};
  if (mode === MODE_B) {
    for (const r of B_RANKS) {
      meta[r] = {
        rank: r,
        name: B_ROLE_NAME[r] || RANK_TEXT[r],
        group: B_GROUP[r],
        power: B_POWER[r] || 0,
        text: RANK_TEXT[r],
      };
    }
    return meta;
  }
  for (let r = 2; r <= 16; r += 1) {
    meta[r] = {
      rank: r,
      name: A_ROLE_NAME[r] || RANK_TEXT[r],
      side: sideOfA(r),
      power: A_IMMORTAL_POWER[r] || A_DEMON_POWER[r] || 0,
      text: RANK_TEXT[r],
    };
  }
  return meta;
}

export function cardLabel(card) {
  if (card.suit === 'joker') return RANK_TEXT[card.rank];
  return `${SUIT_TEXT[card.suit]}${RANK_TEXT[card.rank]}`;
}

/** 按点数分组，用于「同点出牌」 */
export function groupByRank(cards) {
  const map = new Map();
  for (const c of cards) {
    if (!map.has(c.rank)) map.set(c.rank, []);
    map.get(c.rank).push(c);
  }
  return map;
}
