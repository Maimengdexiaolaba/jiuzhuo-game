/**
 * 超级梦幻（梦幻扎金花 · 两张暗牌版）—— 牌组与牌面元数据
 * 每人 2 张暗牌，无公牌，想象第 3 张组成最大牌型。
 */

export const JOKER_S = 15; // 小王
export const JOKER_B = 16; // 大王

export const RANK_TEXT = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
  15: '小王', 16: '大王',
};

/** 是否是大小王 */
export function isJoker(card) {
  return card.rank >= JOKER_S;
}

export function buildDeck(withJoker) {
  const deck = [];
  const suits = ['s', 'h', 'd', 'c'];
  for (let r = 2; r <= 14; r += 1) {
    for (const suit of suits) {
      deck.push({ id: `${suit}${r}`, suit, rank: r });
    }
  }
  if (withJoker) {
    deck.push({ id: 'jokers', suit: 'joker', rank: JOKER_S });
    deck.push({ id: 'jokerb', suit: 'joker', rank: JOKER_B });
  }
  return deck;
}

export function deckSize(withJoker) {
  return withJoker ? 54 : 52;
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 供前端展示的牌面角色元数据（复用扑克牌美术，无额外角色） */
export function cardMeta(withJoker) {
  const meta = {};
  for (let r = 2; r <= 14; r += 1) {
    meta[r] = { rank: r, name: RANK_TEXT[r], text: RANK_TEXT[r], isJoker: false };
  }
  if (withJoker) {
    meta[JOKER_S] = { rank: JOKER_S, name: '小王', text: '小王', isJoker: true };
    meta[JOKER_B] = { rank: JOKER_B, name: '大王', text: '大王', isJoker: true };
  }
  return meta;
}
