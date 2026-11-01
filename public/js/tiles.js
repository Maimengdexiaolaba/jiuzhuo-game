/**
 * 麻将牌渲染。
 *
 * 牌面来自开源项目 lietxia/mahjong_graphic（M+ 授权，可商用），
 * 已随项目保存到 /assets/mahjong/，运行时不访问任何外部地址。
 * 详见 public/assets/mahjong/README.md
 */

const TILE_ASSET = '/assets/mahjong';

/** rank: 1~9 表示筒子，0 表示幺鸡 */
export function tileFile(rank) {
  return rank === 0 ? '1s' : `${rank}p`;
}

export function tileLabel(rank) {
  if (rank === 0) return '幺鸡';
  return `${rank}筒`;
}

/**
 * 生成一张牌的 HTML
 * @param {number|null|undefined} rank 1~9，0 表示幺鸡；null/undefined 表示背面
 */
export function tileHTML(rank, { size = 'md', extraClass = '', data = {} } = {}) {
  const isBack = rank === null || rank === undefined;
  const cls = ['tile', `tile--${size}`];
  if (isBack) cls.push('tile--back');
  if (extraClass) cls.push(extraClass);

  const attrs = Object.entries(data)
    .map(([k, v]) => `data-${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join(' ');

  const inner = isBack
    ? '<span class="tile-back-pattern" aria-hidden="true"></span>'
    : `<img class="tile-img" src="${TILE_ASSET}/${tileFile(rank)}.svg"
         alt="${tileLabel(rank)}" draggable="false" decoding="sync" />`;

  return `<div class="${cls.join(' ')}" ${attrs} role="img" aria-label="${isBack ? '牌背' : tileLabel(rank)}">${inner}</div>`;
}

export function handToHTML(hand, opts = {}) {
  if (!hand || !hand.length) return '';
  return hand.map((c) => tileHTML(c.r, opts)).join('');
}

/** 牌型徽标：把服务端算好的手牌摘要渲染成一个小标签 */
export function handBadgeHTML(info, { size = 'sm' } = {}) {
  if (!info) return '';
  const cls = info.key === 'birdPair' ? 'bird'
    : info.key === 'erba' ? 'erba'
      : info.isPair ? 'pair' : '';
  return `<span class="hand-badge ${cls} ${size}">${info.name}</span>`;
}
