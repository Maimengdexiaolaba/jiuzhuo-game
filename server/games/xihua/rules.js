import {
  MODE_B, A_IMMORTAL_POWER, A_DEMON_POWER, B_GROUP, B_POWER,
  RANK_TEXT, sideOfA,
} from './cards.js';

/** 每局最多出同点牌的张数：同点牌最多 4 张，一次可出任意张（1~4） */
export function maxPlayCount(mode) {
  return 4;
}

/** 是否为「过牌」2 */
export function isPassCard(rank) {
  return rank === 2;
}

/**
 * 6 白龙马：A 方案是仙界最小的一张普通牌（可管妖、可被其他仙界管）；
 * 只有 B 方案才是「转上家出牌」的功能牌。
 */
export function isTurnBackCard(rank, mode) {
  return mode === MODE_B && rank === 6;
}

/**
 * A 方案：a 能否管住 b
 * 仙界：如来 > 菩萨 > 唐僧 > 悟空 > 八戒 > 沙僧 > 白龙马
 * 妖界：A > K > Q > J > 9 > 7 > 4
 * 克制：所有妖精都能管唐僧；除唐僧外，所有仙界都能管妖精
 */
export function canBeatA(a, b) {
  if (a === b) return false;
  if (a === 2 || b === 2) return false; // 过牌不参与比大小

  const sa = sideOfA(a);
  const sb = sideOfA(b);
  if (sa === 'immortal' && sb === 'immortal') {
    return A_IMMORTAL_POWER[a] > A_IMMORTAL_POWER[b];
  }
  if (sa === 'demon' && sb === 'demon') {
    return A_DEMON_POWER[a] > A_DEMON_POWER[b];
  }
  if (sa === 'immortal' && sb === 'demon') {
    return a !== 10; // 除唐僧外，仙界都能管妖精
  }
  if (sa === 'demon' && sb === 'immortal') {
    return b === 10; // 妖精只能管唐僧这一张仙界牌
  }
  return false;
}

/**
 * B 方案：a 能否管住 b
 * 链：大妖 K > 中妖 Q > 小妖 J > 唐僧 10 > 悟空 5 > 八戒 8 > 沙僧 3
 * 循环克制：妖 > 唐僧 > 徒弟 > 妖
 */
export function canBeatB(a, b) {
  if (a === b) return false;
  if (a === 2 || b === 2) return false;
  if (a === 6 || b === 6) return false; // 白龙马是功能牌

  const ga = B_GROUP[a];
  const gb = B_GROUP[b];
  if (!ga || !gb) return false;
  if (ga === 'special' || gb === 'special') return false;

  if (ga === 'demon' && gb === 'monk') return true; // 妖吃唐僧
  if (ga === 'monk' && gb === 'disciple') return true; // 唐僧管徒弟
  if (ga === 'disciple' && gb === 'demon') return true; // 徒弟打妖怪
  if (ga === gb) return B_POWER[a] > B_POWER[b];
  return false;
}

export function canBeat(a, b, mode) {
  return mode === MODE_B ? canBeatB(a, b) : canBeatA(a, b);
}

/** 牌力说明文本 */
export function describeRank(rank, mode) {
  if (mode === MODE_B) {
    const g = B_GROUP[rank];
    const map = { demon: '妖界', monk: '唐僧', disciple: '徒弟', pass: '过牌', special: '特殊' };
    return map[g] || '';
  }
  const side = sideOfA(rank);
  if (side === 'pass') return '过牌';
  return side === 'immortal' ? '仙界' : '妖界';
}

/**
 * 校验一次出牌
 * @returns {{ok:boolean, error?:string, rank?:number, count?:number, kind?:string}}
 */
export function validatePlay(cards, table, mode) {
  if (!cards || !cards.length) return { ok: false, error: '请选择要出的牌' };

  const rank = cards[0].rank;
  if (!cards.every((c) => c.rank === rank)) {
    return { ok: false, error: '一次只能出相同点数的牌' };
  }
  const count = cards.length;
  if (count > maxPlayCount(mode)) {
    return { ok: false, error: `本玩法一次最多出 ${maxPlayCount(mode)} 张` };
  }

  // 跟牌阶段：任何牌（含 2/6 功能牌）都必须张数与桌面一致
  if (table && count !== table.count) {
    return { ok: false, error: `需要出 ${table.count} 张才能管` };
  }

  // 2 = 过牌：可单张或多张甩出，都是让过（不罚、不收牌）
  if (isPassCard(rank)) {
    return { ok: true, rank, count, kind: 'pass' };
  }

  // B 方案白龙马：可单张或多张甩出，出牌权交给上家
  if (isTurnBackCard(rank, mode)) {
    return { ok: true, rank, count, kind: 'turnback' };
  }

  if (table) {
    if (!canBeat(rank, table.rank, mode)) {
      return { ok: false, error: `管不住 ${RANK_TEXT[table.rank]}` };
    }
    return { ok: true, rank, count, kind: 'beat' };
  }

  return { ok: true, rank, count, kind: 'lead' };
}
