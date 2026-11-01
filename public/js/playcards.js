/**
 * 扑克牌渲染（纸牌西游记）
 * 牌面直接使用美术出图：public/assets/xihua/cards/{花色}{点数}.jpg
 */

const RANK_KEY = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export const RANK_TEXT = {
  ...RANK_KEY, 15: '小王', 16: '大王',
};

const SUIT_KEY = { s: 's', h: 'h', d: 'd', c: 'c' };
const SUIT_TEXT = { s: '♠', h: '♥', d: '♦', c: '♣' };

const ASSET = '/assets/xihua';

export function cardFile(card) {
  if (card.rank === 16) return 'joker_b';
  if (card.rank === 15) return 'joker_s';
  return `${SUIT_KEY[card.suit] || 's'}${RANK_KEY[card.rank] || card.rank}`;
}

export function cardSrc(card) {
  return `${ASSET}/cards/${cardFile(card)}.jpg`;
}

/**
 * @param {{id:string,suit:string,rank:number}} card
 * @param {{size?:string, selected?:boolean, meta?:object, dim?:boolean, playable?:boolean, idx?:number, extraClass?:string}} opts
 */
export function playCardHTML(card, opts = {}) {
  const { size = 'md', selected = false, meta = null, dim = false, playable = false, idx = -1, extraClass = '', style = '' } = opts;
  const cls = ['pcard', `pcard--${size}`];
  if (selected) cls.push('is-selected');
  if (dim) cls.push('is-dim');
  if (playable) cls.push('is-playable');
  if (card.rank >= 15) cls.push('pcard--joker');
  if (extraClass) cls.push(extraClass);

  const label = `${SUIT_TEXT[card.suit] || ''}${RANK_TEXT[card.rank] || ''} ${meta?.name || ''}`.trim();
  const idxAttr = idx >= 0 ? ` data-idx="${idx}"` : '';

  return `<div class="${cls.join(' ')}" data-rank="${card.rank}"${idxAttr} role="img" aria-label="${label}"${style ? ` style="${style}"` : ''}>
    <img class="pcard-img" src="${cardSrc(card)}" alt="${label}" draggable="false" decoding="async" loading="eager" />
  </div>`;
}

export function backCardHTML(size = 'sm', extraClass = '') {
  return `<div class="pcard pcard--${size} pcard--back ${extraClass}">
    <img class="pcard-img" src="${ASSET}/back.jpg" alt="牌背" draggable="false" />
  </div>`;
}

export const CARD_RANK_TEXT = RANK_TEXT;
