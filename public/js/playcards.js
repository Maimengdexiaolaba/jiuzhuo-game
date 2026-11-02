/**
 * 扑克牌渲染（纸牌西游记 / 超级梦幻 共用）
 * - 西游记：角色插画牌面 /assets/xihua/cards/*.jpg
 * - 超级梦幻：点数牌面 /assets/supermeng/cards/*.svg（CC0）
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

const ASSETS = {
  xihua: { dir: '/assets/xihua/cards', ext: 'jpg', back: '/assets/xihua/back.jpg' },
  supermeng: { dir: '/assets/supermeng/cards', ext: 'svg', back: '/assets/xihua/back.jpg' },
};

/** 当前用户的牌面皮肤（classic | xihua），默认经典 */
let cardFace = 'classic';

/** 皮肤值 → 素材目录 key */
const FACE_ASSET = { classic: 'supermeng', xihua: 'xihua' };

/** 设置牌面皮肤（由 App 根据用户 skins 调用） */
export function setCardFace(face) {
  cardFace = face === 'xihua' ? 'xihua' : 'classic';
}

export function getCardFace() {
  return cardFace;
}

/** 当前皮肤对应的默认素材 key */
function defaultAsset() {
  return FACE_ASSET[cardFace] || 'supermeng';
}

/**
 * 是否默认叠加「大号数字 + 花色」角标：
 * - 西游记插画牌面本身没有数字 → 需要角标保证可读
 * - 经典 CC0 扑克牌面自带清晰的数字角标 → 不再叠加，避免盖住原牌角
 */
function defaultCorner() {
  return cardFace === 'xihua';
}

export function cardFile(card) {
  if (card.rank === 16) return 'joker_b';
  if (card.rank === 15) return 'joker_s';
  return `${SUIT_KEY[card.suit] || 's'}${RANK_KEY[card.rank] || card.rank}`;
}

export function cardSrc(card, asset = 'xihua') {
  const a = ASSETS[asset] || ASSETS.xihua;
  return `${a.dir}/${cardFile(card)}.${a.ext}`;
}

/**
 * @param {{id:string,suit:string,rank:number}} card
 * @param {{size?:string, selected?:boolean, meta?:object, dim?:boolean, playable?:boolean, idx?:number, extraClass?:string, asset?:string, corner?:boolean}} opts
 */
export function playCardHTML(card, opts = {}) {
  const { size = 'md', selected = false, meta = null, dim = false, playable = false, idx = -1, extraClass = '', style = '', asset = defaultAsset() } = opts;
  const corner = opts.corner !== undefined ? opts.corner : defaultCorner();
  const cls = ['pcard', `pcard--${size}`];
  if (selected) cls.push('is-selected');
  if (dim) cls.push('is-dim');
  if (playable) cls.push('is-playable');
  if (card.rank >= 15) cls.push('pcard--joker');
  if (extraClass) cls.push(extraClass);

  const label = `${SUIT_TEXT[card.suit] || ''}${RANK_TEXT[card.rank] || ''} ${meta?.name || ''}`.trim();
  const idxAttr = idx >= 0 ? ` data-idx="${idx}"` : '';

  // 牌角角标：大号数字 + 花色，独立渲染保证可读（不依赖美术图内小字）
  const isJoker = card.rank >= 15;
  const isRed = card.suit === 'h' || card.suit === 'd';
  const rankText = RANK_TEXT[card.rank] || '';
  const suitText = SUIT_TEXT[card.suit] || '';
  const cornerHTML = !corner ? '' : (isJoker
    ? `<span class="pcard-corner joker">${rankText}</span>`
    : `<span class="pcard-corner ${isRed ? 'red' : 'black'}">
         <b>${rankText}</b><i>${suitText}</i>
       </span>`);

  return `<div class="${cls.join(' ')}" data-rank="${card.rank}"${idxAttr} role="img" aria-label="${label}"${style ? ` style="${style}"` : ''}>
    <img class="pcard-img" src="${cardSrc(card, asset)}" alt="${label}" draggable="false" decoding="async" loading="eager" />
    ${cornerHTML}
  </div>`;
}

export function backCardHTML(size = 'sm', extraClass = '', asset = defaultAsset()) {
  const a = ASSETS[asset] || ASSETS.xihua;
  return `<div class="pcard pcard--${size} pcard--back ${extraClass}">
    <img class="pcard-img" src="${a.back}" alt="牌背" draggable="false" />
  </div>`;
}

export const CARD_RANK_TEXT = RANK_TEXT;
