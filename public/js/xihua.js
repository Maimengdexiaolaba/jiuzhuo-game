import { escapeHTML, initials, openModal, closeAllModals } from './ui.js';
import { playCardHTML, backCardHTML } from './playcards.js';
import { sfx, speakXihuaPlay, speakXihuaPass } from './audio.js';

const PHASE_TEXT = {
  play: '轮流出牌',
  penalty: '罚酒确认',
  settle: '本局结算',
};

// 角色 rank -> 播报 roleKey
const ROLE_KEY = {
  8: 'bajie', 5: 'wukong', 2: 'jindouyun', 10: 'tangseng',
  11: 'baigujing', 6: 'bailongma', 3: 'shaseng', 13: 'hongaier',
  12: 'tieshan', 4: 'xiaozuanfeng', 9: 'niumowang', 7: 'zhizhujing', 14: 'dapeng',
};

let sel = { rank: null, count: 1 };
let modalKey = null;
let dismissed = false;
let lastRound = null;
let lastSeq = 0;

export function resetXihuaView() {
  sel = { rank: null, count: 1 };
  modalKey = null;
  dismissed = false;
  lastRound = null;
  lastSeq = 0;
}

/**
 * 点手牌选择点数。跟牌时张数由桌面决定；领出时点第 N 张就表示出 N 张。
 */
export function setXihuaSelection(rank, idx = 0, fixedCount = 0) {
  if (fixedCount > 0) {
    sel.rank = rank;
    sel.count = fixedCount;
    return;
  }
  const want = idx + 1;
  if (sel.rank === rank && sel.count === want) {
    sel.rank = null;
    sel.count = 1;
    return;
  }
  sel.rank = rank;
  sel.count = want;
}

export function setXihuaCount(n) {
  sel.count = n;
}

function groupHand(hand) {
  const map = new Map();
  for (const c of hand) {
    if (!map.has(c.rank)) map.set(c.rank, []);
    map.get(c.rank).push(c);
  }
  return new Map([...map.entries()].sort((a, b) => a[0] - b[0]));
}

function nameOf(room, seat) {
  return room.players.find((p) => p.seat === seat)?.name || `座位 ${seat}`;
}

/** 西游记事件音效与播报 */
function handleXihuaEvents(g) {
  const ev = g?.lastEvent;
  if (!ev) return;
  if (!lastSeq) { lastSeq = ev.seq; return; }
  if (ev.seq <= lastSeq) return;
  lastSeq = ev.seq;

  if (ev.type === 'play') {
    sfx.play();
    const roleKey = ROLE_KEY[ev.rank];
    if (roleKey) speakXihuaPlay(ev.count, roleKey);
  } else if (ev.type === 'passCard') {
    sfx.play();
    const roleKey = ROLE_KEY[ev.rank];
    if (roleKey) speakXihuaPlay(1, roleKey);
  } else if (ev.type === 'turnback') {
    sfx.cut();
    speakXihuaPlay(1, 'bailongma');
  } else if (ev.type === 'collect') {
    sfx.penalty();
  } else if (ev.type === 'penalty') {
    sfx.penalty();
  } else if (ev.type === 'settle') {
    sfx.win();
  }
}

/* ---------------- 主牌桌 ---------------- */

export function xihuaTableHTML(App, room) {
  const g = room.game;
  const me = room.mySeat;
  const meta = g.meta || {};
  const myHand = room.myHand || [];
  const groups = groupHand(myHand);
  const isSpectator = !!room.isSpectator;

  // 事件驱动的音效与播报
  handleXihuaEvents(g);

  const myTurn = g.phase === 'play' && g.currentSeat === me;
  const playable = new Set(room.hints?.playable || []);
  const table = g.table;

  const selCards = sel.rank !== null ? (groups.get(sel.rank) || []) : [];
  const selCount = table
    ? table.count
    : Math.min(sel.count || 1, selCards.length || 1, g.maxPlay || 4);

  return `
  <div class="felt felt-xihua">
    ${xhSeats(room, g)}
    <div class="xh-center">
      ${xhTableCards(room, g)}
    </div>
    ${isSpectator
      ? '<div class="spectator-bar"><i class="pulse"></i>观 战 中 · 仅可见公共牌面</div>'
      : `<div class="xh-me">
      <div class="xh-my-bar">
        <span class="xh-my-title">我的手牌</span>
        <span class="xh-my-count">剩 <b>${myHand.length}</b> 张</span>
        ${g.mode === 'b36'
          ? `<span class="xh-zone-tag">惩罚区 <b>${g.penaltyZoneCounts?.[me] ?? 0}</b> 张</span>`
          : `<span class="xh-zone-tag">已罚 <b>${g.penalties?.[me] ?? 0}</b> 杯</span>`}
      </div>
      <div class="xh-hand ${myHand.length > 18 ? 'is-dense' : ''}">
        ${myHand.length
          ? [...groups.entries()].map(([rank, cs]) => `
              <div class="xh-group ${sel.rank === rank ? 'is-selected' : ''} ${myTurn && (playable.has(rank) || rank === 2 || rank === 6) ? 'is-playable' : ''}">
                ${cs.map((c, i) => playCardHTML(c, {
                  size: 'md',
                  meta: meta[c.rank],
                  idx: i,
                  selected: sel.rank === rank && i < selCount,
                })).join('')}
              </div>`).join('')
          : '<span class="xh-empty-hand">手牌已出完</span>'}
      </div>
      <div class="xh-actions">${xihuaActions(App, room, g, myTurn, selCards, table, playable)}</div>
    </div>`}
    ${g.phase === 'penalty' ? xhPenaltyOverlay(room, g) : ''}
  </div>`;
}

function xhSeats(room, g) {
  const finishedOrder = g.finished || [];
  return `
    <div class="xh-seats" style="--seat-count:${room.players.length}">
      ${room.players.map((p) => {
        const isTurn = g.phase === 'play' && g.currentSeat === p.seat;
        const done = finishedOrder.includes(p.seat);
        const place = done ? finishedOrder.indexOf(p.seat) + 1 : null;
        const cards = g.handCounts?.[p.seat] ?? 0;
        const zone = g.penaltyZoneCounts?.[p.seat] ?? 0;
        const cups = g.penalties?.[p.seat] ?? 0;
        return `
        <div class="xh-seat ${isTurn ? 'is-turn' : ''} ${done ? 'is-done' : ''} ${p.seat === room.mySeat ? 'is-me' : ''}">
          <div class="xh-seat-top">
            <span class="pod-avatar">${escapeHTML(initials(p.name))}</span>
            <span class="xh-seat-name">${escapeHTML(p.name)}</span>
            ${place ? `<span class="xh-place">#${place}</span>` : ''}
            ${p.isBot ? '<span class="pod-badge bot">AI</span>' : ''}
          </div>
          <div class="xh-seat-info">
            ${done
              ? '<span class="xh-done-tag">已出完</span>'
              : `<span class="xh-cards">牌 <b>${cards}</b></span>`}
            ${g.mode === 'b36'
              ? `<span class="xh-zone">罚区 <b>${zone}</b></span>`
              : `<span class="xh-zone">罚 <b>${cups}</b> 杯</span>`}
          </div>
          <div class="xh-mini-hand">
            ${Array.from({ length: Math.min(cards, 8) }, () => backCardHTML('xs')).join('')}
            ${cards > 8 ? `<span class="xh-more">+${cards - 8}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

/**
 * 桌面牌堆的叠放比例：牌越多叠得越紧，保证整轮牌都能摆在一屏里。
 */
function stackOverlap(n) {
  if (n <= 1) return 0;
  const mobile = window.innerWidth <= 760;
  const cardW = mobile
    ? Math.min(92, window.innerWidth * 0.26)
    : Math.min(140, Math.max(90, window.innerWidth * 0.076));
  const avail = Math.min(window.innerWidth - (mobile ? 52 : 140), 1180);
  const step = Math.max(16, (avail - cardW) / (n - 1));
  return Math.min(0.82, Math.max(0.1, 1 - step / cardW));
}

function xhTableCards(room, g) {
  const table = g.table;
  const meta = g.meta || {};
  const pile = g.trickCards || [];

  if (!table || !table.cards?.length) {
    const leading = g.currentSeat === room.mySeat;
    return `
      <div class="xh-table-empty">
        <span>${leading ? '轮到你领出' : `等待 ${escapeHTML(nameOf(room, g.currentSeat))} 领出`}</span>
        <small>${leading ? '任选一种点数出牌' : '桌面已清空'}</small>
      </div>`;
  }

  const n = pile.length || table.count;
  const ov = stackOverlap(n);
  const currentIds = new Set((table.cards || []).map((c) => c.id));

  return `
    <div class="xh-table-main">
      <div class="xh-table-cards is-stacked" style="--ov:${ov.toFixed(3)}">
        ${pile.map((c, i) => playCardHTML(c, {
          size: 'lg',
          meta: meta[c.rank],
          extraClass: currentIds.has(c.id) ? 'is-current' : '',
          style: `z-index:${i + 1};${i ? 'margin-left:calc(var(--table-w) * -1 * var(--ov));' : ''}`,
        })).join('')}
      </div>
      <div class="xh-table-need">
        <span class="xh-table-owner">
          ${escapeHTML(nameOf(room, table.seat))} 出 ${table.count} 张
          <b>${escapeHTML(meta[table.rank]?.name || table.rank)}</b>
        </span>
        <span class="xh-pile-count">本轮 <b>${n}</b> 张</span>
        <span class="xh-need-tip">需 ${table.count} 张更大的牌才能管</span>
      </div>
    </div>`;
}

function xihuaActions(App, room, g, myTurn, selCards, table, playable) {
  if (g.phase === 'settle') {
    const isWinner = g.results?.winnerSeat === room.mySeat;
    return isWinner
      ? `<button class="btn btn-primary btn-lg" data-act="nextRound">开 始 下 一 局</button>
         <div class="action-tip">你是本局第一名，下一局由你先出牌</div>`
      : `<div class="action-row"><button class="btn btn-ghost" data-act="xhSettle">本局结算</button></div>
         <div class="action-tip">等待第一名开启下一局</div>`;
  }

  if (g.phase === 'penalty') {
    return '<span class="wait-note"><i class="spinner"></i>罚酒确认中…</span>';
  }

  if (!myTurn) {
    return `<span class="wait-note"><i class="spinner"></i>等待 ${escapeHTML(nameOf(room, g.currentSeat))} 出牌</span>`;
  }

  if (!selCards.length) {
    return `
      <div class="action-tip">点击手牌选择要出的点数${table ? `（需要 ${table.count} 张）` : ''}</div>
      ${table ? '<div class="action-row"><button class="btn btn-ghost" data-act="pass">管 不 住</button></div>' : ''}`;
  }

  const rank = sel.rank;
  const isPass = rank === 2;
  const isDragon = g.mode === 'b36' && rank === 6;
  const need = table ? table.count : Math.min(sel.count || 1, selCards.length, g.maxPlay || 4);
  const beatable = playable.has(rank) || selCards.length >= need;
  const enough = selCards.length >= need && beatable;
  const cards = selCards.slice(0, need);
  const ids = cards.map((c) => c.id).join(',');

  if (isPass || isDragon) {
    // 2/6 也可选多张（功能不变：2=过牌、6=转上家）；跟牌时张数必须与桌面一致
    const maxForSpecial = table ? table.count : Math.min(selCards.length, g.maxPlay || 4);
    const countPicker = !table
      ? `<div class="xh-count-picker">
           ${Array.from({ length: maxForSpecial }, (_, i) => i + 1)
             .map((n) => `<button class="xh-count-btn ${n === need ? 'is-on' : ''}" data-act="xhCount" data-count="${n}">${n} 张</button>`)
             .join('')}
         </div>`
      : '';
    const label = isPass ? '过 牌' : '白 龙 马';
    const tip = isPass ? '筋斗云是过牌：让过、不罚、不收牌' : '';
    const canPlay = selCards.length >= need;
    return `
      ${countPicker}
      <button class="btn btn-primary" data-act="play" data-cards="${ids}" ${canPlay ? '' : 'disabled'}>
        出 ${need} 张${label}
      </button>
      ${tip ? `<div class="action-tip">${tip}</div>` : ''}`;
  }

  const maxForRank = Math.min(
    selCards.length,
    g.maxPlay || 4,
    (room.hints?.counts && room.hints.counts[rank]) || selCards.length
  );
  const countPicker = !table
    ? `<div class="xh-count-picker">
         ${Array.from({ length: maxForRank }, (_, i) => i + 1)
           .map((n) => `<button class="xh-count-btn ${n === need ? 'is-on' : ''}" data-act="xhCount" data-count="${n}">${n} 张</button>`)
           .join('')}
       </div>`
    : '';

  return `
    ${countPicker}
    <div class="action-row">
      <button class="btn btn-primary" data-act="play" data-cards="${ids}" ${enough ? '' : 'disabled'}>
        出 ${need} 张 ${escapeHTML((g.meta?.[rank]?.name) || '')}
      </button>
      ${table ? '<button class="btn btn-ghost" data-act="pass">管不住</button>' : ''}
    </div>
    ${table ? `<div class="action-tip">管不住会把本轮已出的 ${g.trickPileCount || table.count} 张牌全部收进你的惩罚区，并由你领出下一轮</div>` : ''}`;
}

function xhPenaltyOverlay(room, g) {
  const p = g.penalty;
  if (!p) return '';
  const mine = p.seat === room.mySeat;
  const name = nameOf(room, p.seat);
  return `
    <div class="xh-penalty-overlay">
      <div class="xh-penalty-card ${mine ? 'is-mine' : ''}">
        <div class="xh-penalty-label">${mine ? '你被罚酒' : `${escapeHTML(name)} 被罚酒`}</div>
        <div class="xh-penalty-cups"><b>${p.cups}</b><span>杯</span></div>
        <div class="xh-penalty-reason">${escapeHTML(p.reason || '')}</div>
        ${mine
          ? `<button class="btn btn-primary btn-lg" data-act="ackPenalty">喝 完 了</button>
             <div class="action-tip">喝完点击继续</div>`
          : `<div class="wait-note"><i class="spinner"></i>等待 ${escapeHTML(name)} 喝完…</div>`}
        ${g.penaltyQueueLen > 1 ? `<div class="xh-penalty-queue">第 ${g.penaltyCursor + 1} / ${g.penaltyQueueLen} 位</div>` : ''}
      </div>
    </div>`;
}

/* ---------------- 规则图 ---------------- */

export function openRulesModal(App, room) {
  const mode = room.game?.mode || 'a54';
  const isB = mode === 'b36';
  const src = isB ? '/assets/xihua/rules-36.jpg' : '/assets/xihua/rules-54.jpg';
  openModal({
    title: '玩法说明',
    subtitle: isB ? '36 张 · 精简版' : '54 张 · 经典版',
    body: `<img class="rules-img" src="${src}" alt="玩法说明" title="点击查看大图" data-zoom="${src}" />`,
    size: 'modal-wide',
    footer: '<button class="btn btn-ghost" data-close>收起</button>',
  });
  document.querySelector('.rules-img')?.addEventListener('click', (e) => {
    window.open(e.currentTarget.dataset.zoom, '_blank');
  });
}

/* ---------------- 结算弹窗 ---------------- */

export function syncXihuaModal(App, room) {
  const g = room.game;
  if (!g) return;
  if (g.phase !== 'settle') {
    if (modalKey) { closeAllModals(); modalKey = null; }
    dismissed = false;
    return;
  }
  const key = `xh:${g.roundNo}`;
  if (lastRound !== g.roundNo) { lastRound = g.roundNo; dismissed = false; }
  if (dismissed || key === modalKey) return;
  modalKey = key;
  openXihuaSettle(App, room);
}

export function reopenXihuaSettle(App, room) {
  dismissed = false;
  modalKey = null;
  openXihuaSettle(App, room);
}

function openXihuaSettle(App, room) {
  const g = room.game;
  const res = g.results;
  if (!res) return;
  const isB = res.mode === 'b36';
  const winner = res.winnerSeat;
  const isWinner = winner === room.mySeat;

  const rows = res.entries.map((e) => `
    <tr class="${e.seat === winner ? 'is-winner' : ''}">
      <td class="xh-place-cell">${e.place}</td>
      <td>
        <span class="st-name">
          ${e.seat === winner ? '<span class="pod-badge" style="padding:0 5px">胜</span>' : ''}
          ${escapeHTML(nameOf(room, e.seat))}
        </span>
      </td>
      <td>${e.finished ? '<span class="tag on">已出完</span>' : `<span class="tag">剩 ${e.remaining} 张</span>`}</td>
      ${isB
        ? `<td>${e.zoneCount} 张</td>`
        : `<td>${e.penaltyCups ?? 0} 杯</td>`}
      <td class="num-lose"><b>${e.cups}</b> 杯</td>
    </tr>`).join('');

  const body = `
    <div class="settle-wrap">
      <div class="settle-hero">
        <div>
          <div class="sh-label">第 ${res.roundNo} 局 · ${isB ? '36 张精简版' : '54 张经典版'}</div>
          <div class="sh-main">
            <span class="sh-unit" style="font-size:15px;color:var(--text)">${escapeHTML(nameOf(room, winner))} 率先出完</span>
          </div>
        </div>
        <div class="sh-split">
          <div class="sh-item lose">
            <div class="v">${res.totalCups}</div>
            <div class="k">全场罚杯</div>
          </div>
        </div>
      </div>

      <div class="table-scroll">
        <table class="settle-table">
          <thead>
            <tr>
              <th>名次</th><th>玩家</th><th>状态</th>
              <th>${isB ? `惩罚区（${res.penaltyMode === 'one' ? '1 张 1 杯' : '2 张 1 杯'}）` : '过程罚杯'}</th>
              <th>合计罚杯</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="rules-box">
        <span class="rb-title">规 则 回 顾</span>
        <div class="rule-line"><span>${isB
          ? '管不住时把本轮所有人打出的牌全部收进自己的惩罚区，并由他领出下一轮；最后一名的手牌也并入惩罚区，按张数换算罚杯。'
          : '管不住罚 1 杯；最后剩下的一人按剩余手牌数罚杯。'}</span></div>
        <div class="rule-line" style="color:var(--muted)"><span>下局由本局第一名先出牌。</span></div>
      </div>
    </div>`;

  openModal({
    title: '本局结算',
    subtitle: `第 ${res.roundNo} 局`,
    body,
    size: 'modal-xl',
    footer: isWinner
      ? `<button class="btn btn-ghost" data-close>关闭</button>
         <button class="btn btn-primary" data-act="nextRound">开始下一局</button>`
      : '<button class="btn btn-ghost" data-close>关闭</button>',
    onClose: () => { dismissed = true; modalKey = null; },
  });
}
