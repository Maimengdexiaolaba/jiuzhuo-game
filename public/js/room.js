import { toast, openModal, confirmDialog, escapeHTML, initials, closeAllModals } from './ui.js';
import { tileHTML, handBadgeHTML } from './tiles.js';
import { playShuffle, playDice, playCut } from './fx.js';
import {
  xihuaTableHTML, syncXihuaModal, resetXihuaView,
  setXihuaSelection, setXihuaCount, reopenXihuaSettle, openRulesModal,
} from './xihua.js';
import {
  supermengTableHTML, syncSupermengModal, resetSupermengView,
  reopenSupermengSettle, openSupermengConfig,
} from './supermeng.js';

const PHASE_LABEL = {
  shuffle: '等待庄家洗牌',
  cut_dice: '等待庄家掷骰定切牌人',
  cut_choice: '等待闲家决定是否切牌',
  bet: '闲家押酒中',
  deal_dice: '等待庄家掷骰发牌',
  reveal_dealer: '等待庄家亮牌',
  reveal_players: '等待闲家亮牌',
  settle: '本局已结算',
  big_end: '本庄结束 · 统计中',
  dealer_pick: '移庄',
};

const STEPS = ['洗牌', '切牌', '押酒', '发牌', '亮牌', '结算'];
const STEP_INDEX = {
  shuffle: 0, cut_dice: 1, cut_choice: 1, bet: 2, deal_dice: 3,
  reveal_dealer: 4, reveal_players: 4, settle: 5, big_end: 5, dealer_pick: 5,
};

const GAME_ACTS = [
  'shuffle', 'rollCutDice', 'cut', 'skipCut', 'bet', 'rollDealDice',
  'revealDealer', 'revealSelf', 'nextRound', 'closeSummary', 'pickDealer',
  'play', 'pass', 'ackPenalty',
  'blindChoice', 'changeCards', 'skipChange', 'lock', 'open', 'fold', 'fight', 'stopOpen',
];

let lastSeq = 0;
let seqReady = false;
let lastRoomId = null;
let currentModalKey = null;
let currentModalSig = '';
let dismissedKeys = new Set();
let lastModalPhase = null;
let prevRevealed = new Set();

export function mountRoom(App) {
  const shell = document.getElementById('room-shell');
  const modalRoot = document.getElementById('modal-root');

  shell.addEventListener('click', (e) => {
    const card = e.target.closest('.xh-hand .pcard[data-rank]');
    if (card) {
      const g = App.state.room?.game;
      const fixed = g?.table ? g.table.count : 0;
      setXihuaSelection(Number(card.dataset.rank), Number(card.dataset.idx || 0), fixed);
      render(App);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (btn) handleAction(App, btn);
  });
  modalRoot.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) handleAction(App, btn);
  });

  shell.addEventListener('input', (e) => {
    const range = e.target.closest('[data-host-range]');
    if (range) {
      const label = shell.querySelector('[data-host-range-val]');
      if (label) label.textContent = `${range.value} 人`;
    }
  });

  shell.addEventListener('change', async (e) => {
    const target = e.target.closest('[data-host-config]');
    if (!target) return;
    const key = target.dataset.hostConfig;
    const value = target.type === 'checkbox' ? target.checked : Number(target.value);
    const res = await App.call('room:config', { patch: { [key]: value } });
    if (res.error) toast(res.error, 'error');
  });

  App.renderers.room = () => render(App);
}

/* ---------------- 动作分发 ---------------- */

async function handleAction(App, btn) {
  const act = btn.dataset.act;
  const room = App.state.room;
  if (!room) return;

  if (act === 'leave') {
    const ok = await confirmDialog({
      title: '退出房间',
      message: room.status === 'playing'
        ? '牌局进行中退出会让本局重置，确定要离开吗？'
        : '确定要离开这个房间吗？',
      confirmText: '离开',
      danger: true,
    });
    if (!ok) return;
    await App.call('room:leave', {});
    App.leaveRoomLocal();
    return;
  }

  if (act === 'ready') {
    const me = room.players.find((p) => p.seat === room.mySeat);
    const res = await App.call('room:ready', { ready: !me?.ready });
    if (res.error) toast(res.error, 'error');
    return;
  }

  if (act === 'addBot') {
    const res = await App.call('room:addBot', {});
    if (res.error) toast(res.error, 'error');
    return;
  }

  if (act === 'fillBots') {
    const res = await App.call('room:fillBots', {});
    if (res.error) toast(res.error, 'error');
    else toast(`已加入 ${res.added} 位机器人`, 'ok', 1600);
    return;
  }

  if (act === 'kick') {
    const pid = btn.dataset.pid;
    const target = room.players.find((p) => p.id === pid);
    if (!target) return;
    const ok = await confirmDialog({
      title: target.isBot ? '移除机器人' : '请离玩家',
      message: `确定移除「${escapeHTML(target.name)}」吗？`,
      confirmText: '移除',
      danger: true,
    });
    if (!ok) return;
    const res = target.isBot
      ? await App.call('room:removeBot', { seat: target.seat })
      : await App.call('room:kick', { playerId: pid });
    if (res.error) toast(res.error, 'error');
    return;
  }

  if (act === 'openSettle') {
    dismissedKeys.clear();
    currentModalKey = null;
    currentModalSig = '';
    render(App);
    return;
  }

  if (act === 'openHistory') {
    openHistoryModal(App, room, room.game);
    return;
  }

  if (act === 'xhCount') {
    setXihuaCount(Number(btn.dataset.count));
    render(App);
    return;
  }

  if (act === 'xhSettle') {
    reopenXihuaSettle(App, room);
    return;
  }

  if (act === 'xhRules') {
    openRulesModal(App, room);
    return;
  }

  if (act === 'smSettle' || act === 'smBigStats') {
    reopenSupermengSettle(App, room);
    return;
  }

  if (act === 'smConfig') {
    openSupermengConfig(App, room);
    return;
  }

  if (act === 'smStartBig') {
    const res = await App.call('game:action', { type: 'startBigRound', payload: {} });
    if (res.error) toast(res.error, 'error');
    return;
  }

  if (GAME_ACTS.includes(act)) {
    const payload = act === 'bet'
      ? { cups: Number(btn.dataset.cups) }
      : act === 'pickDealer' || act === 'open'
        ? { seat: btn.dataset.seat !== undefined ? Number(btn.dataset.seat) : null }
        : act === 'blindChoice'
          ? { blind: btn.dataset.blind === '1' }
          : act === 'play'
            ? { cardIds: String(btn.dataset.cards || '').split(',').filter(Boolean) }
            : {};
    btn.disabled = true;
    const res = await App.call('game:action', { type: act, payload });
    btn.disabled = false;
    if (res.error) toast(res.error, 'error');
    return;
  }

  if (act === 'closeBigPanel') {
    // 与本庄统计面板的「关闭并准备」等价
    const res = await App.call('game:action', { type: 'closeSummary', payload: {} });
    if (res.error) toast(res.error, 'error');
  }
}

/* ---------------- 渲染 ---------------- */

function render(App) {
  const room = App.state.room;
  const shell = document.getElementById('room-shell');
  if (!room) { shell.innerHTML = ''; return; }

  if (room.id !== lastRoomId) {
    lastRoomId = room.id;
    lastSeq = 0;
    seqReady = false;
    currentModalKey = null;
    currentModalSig = '';
    dismissedKeys.clear();
    prevRevealed = new Set();
    resetXihuaView();
    resetSupermengView();
    closeAllModals();
  }

  const game = room.game;
  const isXihua = room.gameId === 'xihua';
  const isSupermeng = room.gameId === 'supermeng';
  const me = room.players.find((p) => p.seat === room.mySeat);
  const isDealer = game ? game.dealerSeat === room.mySeat : false;

  // 首次拿到该房间状态时对齐事件序号：若已在牌局中途则跳过历史动画
  if (game && !seqReady) {
    lastSeq = game.lastEvent ? game.lastEvent.seq : 0;
    seqReady = true;
  }
  const newEv = game?.lastEvent && seqReady && game.lastEvent.seq > lastSeq
    ? game.lastEvent
    : null;
  const hideHands = newEv?.type === 'deal';

  shell.innerHTML = `
    ${tableBar(App, room, game, isXihua)}
    ${game && isXihua
      ? xihuaTableHTML(App, room)
      : game && isSupermeng
        ? supermengTableHTML(App, room)
        : `<div class="felt ${game ? '' : 'felt-waiting'}">
          ${game ? stepsBar(game) : ''}
          ${game ? seatsHTML(App, room, game, hideHands) : waitingSeatsHTML(room)}
          ${game ? centerStage(room, game) : waitingCenter(room)}
          ${game ? actionSeat(App, room, game, me, isDealer) : waitingAction(App, room, me)}
        </div>`}`;

  if (game) {
    if (isXihua) {
      syncXihuaModal(App, room);
    } else if (isSupermeng) {
      syncSupermengModal(App, room);
    } else {
      handleEvents(room, game, newEv);
      syncModal(App, room, game);
    }
  } else {
    if (currentModalKey) { closeAllModals(); currentModalKey = null; }
    lastSeq = 0;
    seqReady = false;
    prevRevealed = new Set();
    dismissedKeys.clear();
  }
}

function tableBar(App, room, game, isXihua = false) {
  const chips = (room.configText || []).map((t) => `<span class="chip">${escapeHTML(t)}</span>`).join('');
  const phaseText = game ? (game.phaseText || PHASE_LABEL[game.phase] || '') : '';
  return `
    <div class="table-bar">
      <div class="tb-left">
        <span class="room-code">房间 <b>${escapeHTML(room.id)}</b></span>
        <div class="tb-chips">
          <span class="chip gold">${escapeHTML(room.gameName)}</span>
          ${chips}
        </div>
      </div>
      <div class="tb-right">
        ${game
          ? `<span class="phase-pill"><i class="pulse"></i>${phaseText}</span>`
          : '<span class="phase-pill"><i class="pulse"></i>等待开局</span>'}
        ${!isXihua && game?.history?.length ? `<button class="btn btn-ghost btn-sm" data-act="openHistory">历史回放</button>` : ''}
        ${!isXihua && game?.results ? '<button class="btn btn-ghost btn-sm" data-act="openSettle">结算详情</button>' : ''}
        ${isXihua ? '<button class="btn btn-ghost btn-sm" data-act="xhRules">玩法说明</button>' : ''}
        <button class="btn btn-ghost btn-sm" data-act="leave">退出房间</button>
      </div>
    </div>`;
}

function stepsBar(game) {
  const idx = STEP_INDEX[game.phase] ?? 0;
  const skipped = (game.roundNo || 1) > 1;
  return `
    <div class="steps">
      ${STEPS.map((s, i) => {
        let cls = i < idx ? 'done' : i === idx ? 'now' : '';
        if (skipped && i <= 1) cls = 'done';
        return `<span class="step ${cls}"><i>${i + 1}</i>${s}</span>`;
      }).join('')}
      <span class="step" style="border-left:1px solid rgba(255,255,255,.1);margin-left:6px;padding-left:12px;color:var(--gold)">
        第 ${Math.max(1, game.roundNo || 1)} 局 · 第 ${game.bigRound} 庄
      </span>
    </div>`;
}


/** 手牌摘要短标签：对子类不计点数，直接显示「九筒对 / 幺鸡对 / 二八杠」 */
function shortHand(info) {
  if (!info) return '';
  if (!info.showPoints) return info.name;
  return `${info.point} 点`;
}

function shortHandClass(info) {
  if (!info) return '';
  if (info.key === 'birdPair') return 'bird';
  if (info.key === 'erba') return 'erba';
  if (info.isPair) return 'pair';
  return '';
}

function handTiles(player, size) {
  if (player.hand && player.hand.length) {
    return player.hand.map((c) => tileHTML(c.r, { size })).join('');
  }
  const n = player.handCount || 0;
  if (!n) return '';
  return Array.from({ length: n }, () => tileHTML(null, { size })).join('');
}

function seatsHTML(App, room, game, hideHands = false) {
  const waiting = new Set(game.waitingSeats || []);
  const resultBySeat = {};
  if (game.results) {
    game.results.rows.forEach((r) => { resultBySeat[r.seat] = r; });
    resultBySeat[game.results.dealerRow.seat] = game.results.dealerRow;
  }

  return `
    <div class="seats">
      ${room.players.map((p) => {
        const isMe = p.seat === room.mySeat;
        const res = resultBySeat[p.seat];
        const newlyRevealed = p.revealed && !prevRevealed.has(p.seat);
        let outcomeText = '';
        let outcomeCls = '';
        if (res) {
          if (res.outcome === 'win') { outcomeText = `胜 +${res.cupsWon}`; outcomeCls = 'win'; }
          else if (res.outcome === 'dealer') { outcomeText = `胜${res.cupsWon} 负${res.cupsLost}`; }
          else { outcomeText = `负 -${res.cupsLost}`; outcomeCls = 'lose'; }
        }
        return `
        <div class="pod ${p.seat === game.dealerSeat ? 'is-dealer' : ''} ${isMe ? 'is-me' : ''} ${waiting.has(p.seat) ? 'is-waiting' : ''} ${!p.connected ? 'is-offline' : ''}"
             data-seat="${p.seat}">
          <div class="pod-head">
            <span class="pod-avatar">${escapeHTML(initials(p.name))}</span>
            <span class="pod-name">${escapeHTML(p.name)}${isMe ? ' · 我' : ''}</span>
            ${p.seat === game.dealerSeat ? '<span class="pod-badge">庄</span>' : ''}
            ${p.isBot ? '<span class="pod-badge bot">AI</span>' : ''}
            ${!p.connected ? '<span class="pod-badge off">离线</span>' : ''}
          </div>
          <div class="pod-hand ${hideHands ? 'hide-cards' : ''} ${newlyRevealed ? 'hand-pop' : ''}">
            ${handTiles(p, 'sm')}
            ${p.handInfo ? `<span class="pod-point ${shortHandClass(p.handInfo)}">${shortHand(p.handInfo)}</span>` : ''}
          </div>
          <div class="pod-foot">
            ${p.seat === game.dealerSeat
              ? '<span class="pod-bet">庄家 · 不押酒</span>'
              : p.bet
                ? `<span class="pod-bet">押 ${p.bet} 杯</span>`
                : '<span style="font-size:11px;color:var(--muted)">未押酒</span>'}
            ${outcomeText ? `<span class="pod-result ${outcomeCls}">${outcomeText}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function waitingSeatsHTML(room) {
  const pods = room.players.map((p) => {
    const isHost = p.id === room.hostId;
    const canKick = room.isHost && p.id !== room.hostId;
    return `
      <div class="pod ${isHost ? 'is-dealer' : ''} ${p.seat === room.mySeat ? 'is-me' : ''}">
        <div class="pod-head">
          <span class="pod-avatar">${escapeHTML(initials(p.name))}</span>
          <span class="pod-name">${escapeHTML(p.name)}${p.seat === room.mySeat ? ' · 我' : ''}</span>
          ${isHost ? '<span class="pod-badge">房主</span>' : ''}
          ${p.isBot ? '<span class="pod-badge bot">AI</span>' : ''}
        </div>
        <div class="pod-hand" style="min-height:28px">
          ${p.ready ? '<span class="pod-ready">已准备</span>' : '<span style="font-size:11.5px;color:var(--muted)">未准备</span>'}
        </div>
        <div class="pod-foot">
          <span>${p.isBot ? '机器人' : '玩家'}</span>
          ${canKick ? `<button class="icon-btn" style="width:22px;height:22px;font-size:14px" data-act="kick" data-pid="${p.id}" title="移除">×</button>` : ''}
        </div>
      </div>`;
  });

  const empties = Array.from({ length: Math.max(0, room.capacity - room.players.length) })
    .map(() => '<div class="seat-empty">空位</div>')
    .join('');

  return `<div class="seats">${pods.join('')}${empties}</div>`;
}

function wallHTML(game) {
  const total = game.wallTotal || 40;
  const left = game.phase === 'shuffle' ? total : (game.wallLeft ?? 0);
  const used = total - left;
  const rows = [[], []];
  for (let i = 0; i < total; i += 1) {
    rows[i % 2].push(
      `<span class="tile tile--xs ${i < used ? 'is-used' : 'tile--back'}" style="--tw:11px"></span>`
    );
  }
  return `
    <div class="wall-panel">
      <div class="wall-title">牌 墙</div>
      <div class="wall-stacks">
        <div class="wall-row">${rows[0].join('')}</div>
        <div class="wall-row">${rows[1].join('')}</div>
      </div>
      <div class="wall-count">剩余 <b>${left}</b> / ${total} 张</div>
    </div>`;
}

const PIPS = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function dieFaces(value) {
  const set = new Set((PIPS[value] || []).map(([x, y]) => `${x},${y}`));
  let s = '';
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      s += `<span class="pip-dot" style="visibility:${set.has(`${x},${y}`) ? 'visible' : 'hidden'}"></span>`;
    }
  }
  return s;
}

function diceHTML(game) {
  const dice = game.dealDice || game.cutDice;
  if (!dice) {
    return `
      <div class="dice-pair">
        <div class="die">${dieFaces(0)}</div>
        <div class="die">${dieFaces(0)}</div>
      </div>
      <div class="die-total">尚未掷骰</div>`;
  }
  return `
    <div class="dice-pair">
      <div class="die">${dieFaces(dice.d1)}</div>
      <div class="die">${dieFaces(dice.d2)}</div>
    </div>
    <div class="die-total">点数 <b>${dice.total}</b>${game.dealDice ? '' : ' · 切牌骰'}</div>`;
}

function centerStage(room, game) {
  const dealer = room.players.find((p) => p.seat === game.dealerSeat);
  // 庄家手牌只有在「已亮牌」或结算后才在中央展示，避免提前曝光
  const dealerHand = dealer?.revealed ? dealer.hand : null;
  const dealerResult = game.results?.dealerRow;
  const newlyRevealed = dealer?.revealed && !prevRevealed.has(game.dealerSeat);

  let prompt = '';
  switch (game.phase) {
    case 'shuffle': prompt = `庄家 <b>${escapeHTML(dealer?.name || '')}</b> 请洗牌`; break;
    case 'cut_dice': prompt = '等待庄家掷骰，点数决定由谁切牌'; break;
    case 'cut_choice': {
      const cutter = room.players.find((p) => p.seat === game.cut?.bySeat);
      prompt = `点数命中 <b>${escapeHTML(cutter?.name || '')}</b>，请选择切牌或不切牌`;
      break;
    }
    case 'bet': {
      const total = (game.bets || []).reduce((a, b) => a + b, 0);
      const done = (game.betConfirmed || []).filter(Boolean).length;
      prompt = `闲家押酒中 · 已押 <b>${done}/${room.players.length - 1}</b> 人 · 台面合计 <b>${total}</b> 杯`;
      break;
    }
    case 'deal_dice': prompt = '押酒完成，等待庄家掷骰决定起手位'; break;
    case 'reveal_dealer': prompt = '等待庄家亮牌'; break;
    case 'reveal_players': {
      const done = Math.max(0, (game.revealed || []).filter(Boolean).length - 1);
      prompt = `闲家亮牌 <b>${done}/${room.players.length - 1}</b> 人`;
      break;
    }
    case 'settle': prompt = '本局结算完成'; break;
    case 'big_end': prompt = '牌墙已摸完，本庄结束'; break;
    case 'dealer_pick': prompt = '等待庄家决定连庄或移庄'; break;
    default: prompt = '';
  }

  return `
    <div class="center-stage">
      ${wallHTML(game)}
      <div class="dice-zone">
        ${diceHTML(game)}
        <div class="prompt-line">${prompt}</div>
      </div>
      <div class="dealer-spot ${newlyRevealed ? 'hand-pop' : ''}">
        <div class="ds-label">庄 家 手 牌</div>
        <div class="ds-hand">
          ${dealerHand && dealerHand.length
            ? dealerHand.map((c) => tileHTML(c.r, { size: 'md' })).join('')
            : '<span style="font-size:12px;color:var(--muted)">未亮牌</span>'}
        </div>
        ${dealerResult
          ? `<span class="ds-type">${escapeHTML(dealerResult.handName)}${dealerResult.showPoints === false ? '' : ` · ${dealerResult.points} 点`}</span>`
          : (dealer?.revealed && dealer?.handInfo
            ? `<span class="ds-type ${shortHandClass(dealer.handInfo)}">${escapeHTML(dealer.handInfo.name)}${dealer.handInfo.showPoints ? ` · ${dealer.handInfo.point} 点` : ''}</span>`
            : '')}
      </div>
    </div>`;
}

function actionSeat(App, room, game, me, isDealer) {
  const myHand = me?.hand || [];
  const newlyRevealed = me?.revealed && !prevRevealed.has(room.mySeat);
  const showHand = myHand.length > 0;
  const preDeal = ['shuffle', 'cut_dice', 'cut_choice', 'bet'].includes(game.phase);

  prevRevealed = new Set(
    room.players.filter((p) => p.revealed).map((p) => p.seat)
  );

  const info = me?.handInfo;

  return `
    <div class="my-seat">
      <div class="my-hand-wrap">
        <div class="my-hand ${newlyRevealed ? 'hand-pop' : ''}">
          ${showHand
            ? myHand.map((c) => tileHTML(c.r, { size: 'xl' })).join('')
            : (me?.handCount
              ? Array.from({ length: me.handCount }, () => tileHTML(null, { size: 'xl' })).join('')
              : `<span style="font-size:12.5px;color:var(--muted)">${preDeal ? '尚未发牌' : ''}</span>`)}
        </div>
        ${info ? `
          <div class="my-hand-meta">
            ${handBadgeHTML(info)}
            ${info.showPoints ? `<span class="mh-point">${info.point} 点</span>` : ''}
            <span class="mh-detail">${escapeHTML(info.detail || '')}</span>
          </div>` : ''}
      </div>
      <div class="my-action">${actionPanel(App, room, game, me, isDealer)}</div>
    </div>`;
}

function waitNote(text) {
  return `<span class="wait-note"><i class="spinner"></i>${text}</span>`;
}

function actionPanel(App, room, game, me, isDealer) {
  const mySeat = room.mySeat;

  switch (game.phase) {
    case 'shuffle':
      return isDealer
        ? `<button class="btn btn-primary btn-lg" data-act="shuffle">洗 牌</button>
           <div class="action-tip">40 张牌将随机打乱，分成上下两叠牌墙</div>`
        : waitNote(`等待庄家 ${escapeHTML(room.players[game.dealerSeat]?.name || '')} 洗牌`);

    case 'cut_dice':
      return isDealer
        ? `<button class="btn btn-primary btn-lg" data-act="rollCutDice">掷 骰 定 切 牌 人</button>
           <div class="action-tip">两枚骰子点数相加，决定由谁切牌</div>`
        : waitNote('等待庄家掷骰');

    case 'cut_choice':
      if (mySeat === game.cut?.bySeat) {
        return `
          <div class="action-tip">骰子点数命中你，是否切牌？</div>
          <div class="action-row">
            <button class="btn btn-primary" data-act="cut">切 牌</button>
            <button class="btn btn-ghost" data-act="skipCut">不 切 牌</button>
          </div>`;
      }
      return waitNote(`等待 ${escapeHTML(room.players[game.cut?.bySeat]?.name || '')} 决定是否切牌`);

    case 'bet': {
      if (isDealer) {
        const done = (game.betConfirmed || []).filter(Boolean).length;
        return waitNote(`庄家无需押酒 · 已有 ${done}/${room.players.length - 1} 位闲家押酒`);
      }
      if (me?.betConfirmed) {
        return `<div class="action-tip">你已押 <b style="color:var(--gold-strong)">${me.bet} 杯</b>，等待其他玩家…</div>
                ${waitNote('等待其他闲家押酒')}`;
      }
      return `
        <div class="action-tip">选择本局押酒杯数（闲家手牌为对子时结算翻倍）</div>
        <div class="action-row">
          ${[1, 2, 3].map((c) => `
            <button class="bet-btn" data-act="bet" data-cups="${c}">
              <b>${c}</b><small>杯</small>
            </button>`).join('')}
        </div>`;
    }

    case 'deal_dice':
      return isDealer
        ? `<button class="btn btn-primary btn-lg" data-act="rollDealDice">掷 骰 发 牌</button>
           <div class="action-tip">点数决定第一个摸牌的玩家，随后依次发 2 张手牌</div>`
        : waitNote('等待庄家掷骰发牌');

    case 'reveal_dealer':
      return isDealer
        ? `<button class="btn btn-primary btn-lg" data-act="revealDealer">亮 牌</button>
           <div class="action-tip">亮牌后手牌置于牌桌中心，所有玩家可见</div>`
        : waitNote('等待庄家亮牌');

    case 'reveal_players':
      if (isDealer) {
        const done = Math.max(0, (game.revealed || []).filter(Boolean).length - 1);
        return waitNote(`等待闲家亮牌 ${done}/${room.players.length - 1}`);
      }
      if (game.revealed?.[mySeat]) return waitNote('你已亮牌，等待其他闲家…');
      return `<button class="btn btn-primary btn-lg" data-act="revealSelf">亮 牌</button>
              <div class="action-tip">亮牌后与庄家单独比牌型大小</div>`;

    case 'settle':
      return isDealer
        ? `<div class="action-row">
             <button class="btn btn-primary btn-lg" data-act="nextRound">开 始 游 戏</button>
             <button class="btn btn-ghost" data-act="openSettle">结算详情</button>
           </div>
           <div class="action-tip">下一局流程：闲家押酒 → 掷骰 → 摸牌亮牌结算</div>`
        : `<div class="action-row">
             <button class="btn btn-ghost" data-act="openSettle">查看结算详情</button>
           </div>
           ${waitNote('等待庄家开始下一局')}`;

    case 'big_end':
      return `<div class="action-row">
                <button class="btn btn-primary" data-act="openSettle">查看并关闭统计</button>
              </div>
              ${waitNote('关闭统计面板后自动准备')}`;

    case 'dealer_pick':
      if (isDealer) {
        return `
          <div class="action-row">
            <button class="btn btn-primary" data-act="pickDealer" data-seat="${mySeat}">连 庄</button>
            <button class="btn btn-ghost" data-act="openSettle">选择新庄家</button>
          </div>
          <div class="action-tip">连庄保持当前庄家；移庄后重新洗牌开启新的大回合</div>`;
      }
      return waitNote('等待庄家决定连庄或移庄');

    default:
      return '';
  }
}

function waitingCenter(room) {
  const canStart = room.canStart || {};
  return `
    <div class="center-stage is-waiting">
      <div class="dealer-spot wait-card">
        <div class="ds-label">房 间 号</div>
        <div class="wait-code">${escapeHTML(room.id)}</div>
        <div class="wait-status">
          ${room.players.length} / ${room.capacity} 人已入座<br />
          ${canStart.ok ? '全员已准备，即将开局' : escapeHTML(canStart.reason || '')}
        </div>
      </div>
    </div>`;
}

function waitingAction(App, room, me) {
  const missing = room.capacity - room.players.length;
  const gameDef = (App.state.games || []).find((g) => g.id === room.gameId);
  const maxP = gameDef?.maxPlayers || 10;
  const minP = gameDef?.minPlayers || 2;
  return `
    <div class="my-seat">
      <div class="my-action" style="align-items:center;min-width:auto">
        <div class="action-row" style="justify-content:center">
          <button class="btn ${me?.ready ? 'btn-ghost' : 'btn-primary'} btn-lg" data-act="ready">
            ${me?.ready ? '取消准备' : '准 备'}
          </button>
        </div>
        ${room.isHost ? `
          <div class="action-row" style="justify-content:center">
            ${missing > 0 ? '<button class="btn btn-ghost btn-sm" data-act="addBot">加一个机器人</button>' : ''}
            ${missing > 0 && room.config.botFill ? '<button class="btn btn-ghost btn-sm" data-act="fillBots">一键填满空位</button>' : ''}
          </div>
          <div class="action-row" style="justify-content:center;align-items:center;gap:16px;margin-top:6px">
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)">
              人数
              <input type="range" min="${minP}" max="${maxP}" value="${room.capacity}"
                     data-host-range data-host-config="playerCount" style="width:96px" />
              <b data-host-range-val style="color:var(--gold-strong)">${room.capacity} 人</b>
            </label>
            ${room.gameId === 'tuibingzi' ? `
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)">
              二八最大
              <input type="checkbox" data-host-config="erbaMax" ${room.config.erbaMax ? 'checked' : ''} />
            </label>` : ''}
          </div>
        ` : ''}
        <div class="action-tip" style="text-align:center">
          全部玩家（含机器人）准备后自动开局 · 房主为初始庄家
        </div>
      </div>
    </div>`;
}

/* ---------------- 动画 ---------------- */

function handleEvents(room, game, newEv) {
  if (!newEv) return;
  const ev = newEv;
  const gap = ev.seq - lastSeq;
  lastSeq = ev.seq;
  if (gap > 3) return;

  if (ev.type === 'shuffle') playShuffle();
  else if (ev.type === 'dice') {
    playDice({
      d1: ev.d1, d2: ev.d2, total: ev.total,
      targetName: ev.targetName, isDealer: ev.isDealer, purpose: ev.purpose,
    });
  } else if (ev.type === 'cut') playCut(ev.index);
  else if (ev.type === 'deal') {
    playDice({
      d1: ev.d1, d2: ev.d2, total: ev.total,
      targetName: ev.firstName,
      isDealer: ev.firstSeat === game.dealerSeat,
      purpose: 'deal',
    }).then(() => runDealAnim(ev.order || []));
  }
}

function runDealAnim(order) {
  document.querySelectorAll('.pod[data-seat] .pod-hand').forEach((h) => h.classList.remove('hide-cards'));
  order.forEach((seat, i) => {
    const hand = document.querySelector(`.pod[data-seat="${seat}"] .pod-hand`);
    if (!hand) return;
    hand.querySelectorAll('.tile').forEach((t, j) => {
      t.style.animation = 'dealFly .46s cubic-bezier(.25,.8,.35,1) both';
      t.style.animationDelay = `${i * 110 + j * 70}ms`;
    });
  });
  const myHand = document.querySelector('.my-hand');
  if (myHand) {
    myHand.querySelectorAll('.tile').forEach((t, j) => {
      t.style.animation = 'dealFly .46s cubic-bezier(.25,.8,.35,1) both';
      t.style.animationDelay = `${order.length * 110 + j * 70}ms`;
    });
  }
}

/* ---------------- 弹窗调度 ---------------- */

function syncModal(App, room, game) {
  if (game.phase !== lastModalPhase) {
    lastModalPhase = game.phase;
    dismissedKeys.clear();
  }

  let key = null;
  let sig = '';
  if (game.phase === 'settle') { key = `settle:${game.bigRound}:${game.roundNo}`; sig = key; }
  else if (game.phase === 'big_end') {
    key = `big:${game.bigRound}`;
    sig = `${key}:${(game.summaryReady || []).join('')}`;
  } else if (game.phase === 'dealer_pick') { key = `pick:${game.bigRound}`; sig = key; }

  if (!key) {
    if (currentModalKey) { closeAllModals(); currentModalKey = null; currentModalSig = ''; }
    return;
  }
  if (dismissedKeys.has(key)) return;
  if (key === currentModalKey && sig === currentModalSig) return;

  currentModalKey = key;
  currentModalSig = sig;

  if (game.phase === 'settle') {
    // 稍作延迟，让玩家先看到亮牌结果再弹出结算面板
    setTimeout(() => {
      if (currentModalKey !== key) return;
      if (App.state.view !== 'room') return;
      if (App.state.room?.id !== room.id) return;
      if (App.state.room?.game?.phase !== 'settle') return;
      openSettleModal(App, App.state.room, App.state.room.game, key);
    }, 850);
  } else if (game.phase === 'big_end') {
    openBigModal(App, room, game, key);
  } else {
    openPickModal(App, room, game, key);
  }
}

function markDismissed(key) {
  if (key) dismissedKeys.add(key);
  currentModalKey = null;
  currentModalSig = '';
}

function handTagClass(row) {
  if (row.handKey === 'birdPair') return 'bird';
  if (row.handKey === 'erba') return 'erba';
  if (row.isPair) return 'pair';
  return '';
}


/** 结算明细行（本局结算与历史回放共用） */
function resultRowsHTML(res, room) {
  const nameOf = (seat) => room.players.find((p) => p.seat === seat)?.name || `座位${seat}`;
  return [res.dealerRow, ...res.rows.slice().sort((a, b) => a.seat - b.seat)]
    .map((r) => {
      const isD = r.outcome === 'dealer';
      const outcomeText = isD ? '庄家' : r.outcome === 'win' ? '胜' : r.outcome === 'dealerWin' ? '平·庄胜' : '负';
      const outcomeCls = isD ? '' : r.outcome === 'win' ? 'num-win' : 'num-lose';
      return `
        <tr class="${isD ? 'is-dealer' : ''}">
          <td data-label="玩家">
            <span class="st-name">
              ${isD ? '<span class="pod-badge" style="padding:0 5px">庄</span>' : ''}
              ${escapeHTML(nameOf(r.seat))}
            </span>
          </td>
          <td data-label="手牌"><span class="st-hand">${r.hand.map((c) => tileHTML(c.r, { size: 'sm' })).join('')}</span></td>
          <td data-label="牌型"><span class="hand-tag ${handTagClass(r)}">${escapeHTML(r.handName)}</span></td>
          <td data-label="点数">${r.showPoints === false ? '—' : `${r.points} 点`}</td>
          <td data-label="押酒">${isD ? '—' : `${r.bet} 杯`}</td>
          <td data-label="倍率">${isD ? '—' : `×${r.multiplier}${r.multiplier > 1 ? '<span class="dbl-mark">对子</span>' : ''}`}</td>
          <td data-label="结果" class="${outcomeCls}">${outcomeText}</td>
          <td data-label="胜杯" class="${r.cupsWon ? 'num-win' : 'num-zero'}">${r.cupsWon || 0}</td>
          <td data-label="负杯" class="${r.cupsLost ? 'num-lose' : 'num-zero'}">${r.cupsLost || 0}</td>
        </tr>`;
    })
    .join('');
}


/* ---------------- 历史回放 ---------------- */

function diceText(dice) {
  if (!dice) return '—';
  return `${dice.d1} + ${dice.d2} = <b>${dice.total}</b>`;
}

function openHistoryModal(App, room, game) {
  const history = game?.history || [];
  const nameOf = (seat) => room.players.find((p) => p.seat === seat)?.name || `座位${seat}`;

  const body = history.length
    ? `
      <div class="hist-list">
        ${history.slice().reverse().map((h) => {
          const d = h.results;
          const cutText = h.cut && h.cut.done
            ? (h.cut.skipped ? '未切牌' : `切第 ${h.cut.index} 墩`)
            : '—';
          return `
          <details class="hist-round" ${h.roundNo === history[history.length - 1].roundNo ? 'open' : ''}>
            <summary>
              <span class="hr-no">第 ${h.roundNo} 局</span>
              <span class="hr-meta">庄家 ${escapeHTML(nameOf(h.dealerSeat))}</span>
              <span class="hr-dice">切牌骰 ${h.cutDice ? h.cutDice.total : '—'} · 发牌骰 ${h.dealDice ? h.dealDice.total : '—'}</span>
              <span class="hr-score">庄 胜 <b class="num-win">${d.dealer.won}</b> · 负 <b class="num-lose">${d.dealer.lost}</b></span>
            </summary>
            <div class="hr-body">
              <div class="hr-line">
                <span>切牌骰 <b>${diceText(h.cutDice)}</b></span>
                <span>发牌骰 <b>${diceText(h.dealDice)}</b></span>
                <span>起手 <b>${escapeHTML(nameOf(h.firstSeat))}</b></span>
                <span>切牌 <b>${cutText}</b></span>
                <span>牌墙余 <b>${h.wallLeft}</b> 张</span>
              </div>
              <div class="table-scroll">
                <table class="settle-table">
                  <thead>
                    <tr>
                      <th>玩家</th><th>手牌</th><th>牌型</th><th>点数</th>
                      <th>押酒</th><th>倍率</th><th>结果</th><th>胜杯</th><th>负杯</th>
                    </tr>
                  </thead>
                  <tbody>${resultRowsHTML(d, room)}</tbody>
                </table>
              </div>
              <div class="hr-line hr-line-sub">
                庄家（${escapeHTML(d.dealerRow.handName)} ${d.dealerRow.points} 点）合计胜 ${d.dealer.won} 杯、负 ${d.dealer.lost} 杯
              </div>
            </div>
          </details>`;
        }).join('')}
      </div>
      <div class="rule-line" style="color:var(--muted);font-size:12px">
        <span>仅回放本庄（第 ${game.bigRound} 庄）已完成的 ${history.length} 局，移庄后清空。</span>
      </div>`
    : `<div class="empty-state" style="margin:0;padding:44px 20px"><p>还没有可回放的牌局</p><span>完成第一局后即可查看</span></div>`;

  openModal({
    title: '历史回放',
    subtitle: `第 ${game.bigRound} 庄 · 已完成 ${history.length} 局`,
    body,
    size: 'modal-xl',
    footer: '<button class="btn btn-ghost" data-close>关闭</button>',
  });
}

function openSettleModal(App, room, game, key) {
  const res = game.results;
  if (!res) return;
  const nameOf = (seat) => room.players.find((p) => p.seat === seat)?.name || `座位${seat}`;
  const net = res.dealer.won - res.dealer.lost;

  const rows = resultRowsHTML(res, room);

  const narrative = res.rows
    .map((r) => (r.outcome === 'win'
      ? `<span style="color:#f09a89">负 ${escapeHTML(nameOf(r.seat))} ${r.cupsWon} 杯${r.multiplier > 1 ? '（对子翻倍）' : ''}</span>`
      : `<span style="color:#7fd6a4">胜 ${escapeHTML(nameOf(r.seat))} ${r.cupsLost} 杯${r.multiplier > 1 ? '（对子翻倍）' : ''}</span>`))
    .join('、');

  const body = `
    <div class="settle-wrap">
      <div class="settle-hero">
        <div>
          <div class="sh-label">庄 家 汇 总 · ${escapeHTML(nameOf(res.dealerRow.seat))}</div>
          <div class="sh-main">
            <span class="sh-item win" style="display:inline"><span class="sh-num" style="color:#7fd6a4">${res.dealer.won}</span></span>
            <span class="sh-unit">杯 胜 &nbsp;/&nbsp;</span>
            <span class="sh-item lose" style="display:inline"><span class="sh-num" style="color:#f09a89">${res.dealer.lost}</span></span>
            <span class="sh-unit">杯 负</span>
          </div>
        </div>
        <div class="sh-split">
          <div class="sh-item net">
            <div class="v">${net > 0 ? '+' : ''}${net}</div>
            <div class="k">净胜负</div>
          </div>
          <div class="sh-item">
            <div class="v" style="color:var(--text-dim)">${res.dealerRow.points}</div>
            <div class="k">庄家点数</div>
          </div>
        </div>
      </div>

      <div class="table-scroll">
        <table class="settle-table">
          <thead>
            <tr>
              <th>玩家</th><th>手牌</th><th>牌型</th><th>点数</th>
              <th>押酒</th><th>倍率</th><th>结果</th><th>胜杯</th><th>负杯</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="rules-box">
        <span class="rb-title">本 局 明 细</span>
        <div class="rule-line">
          <span style="line-height:1.9">
            庄家（${escapeHTML(res.dealerRow.handName)}）${narrative}，
            合计胜 ${res.dealer.won} 杯、负 ${res.dealer.lost} 杯。
          </span>
        </div>
        <div class="rule-line" style="color:var(--muted)">
          <span>牌型与点数完全相同时庄家胜；闲家手牌为对子（含一对幺鸡）时该笔杯数翻倍。</span>
        </div>
      </div>
    </div>`;

  const isDealer = room.mySeat === game.dealerSeat;
  openModal({
    title: '本局结算',
    subtitle: `第 ${game.bigRound} 庄 · 第 ${game.roundNo} 局 · 牌墙剩余 ${game.wallLeft} 张`,
    body,
    size: 'modal-xl',
    footer: isDealer
      ? `<button class="btn btn-ghost" data-close>关闭</button>
         <button class="btn btn-primary" data-act="nextRound">开始下一局</button>`
      : '<button class="btn btn-ghost" data-close>关闭</button>',
    onClose: () => markDismissed(key),
  });
}

function openBigModal(App, room, game, key) {
  const totals = game.bigTotals || [];
  const rows = room.players
    .map((p) => {
      const t = totals[p.seat] || { won: 0, lost: 0 };
      return { p, t, net: t.won - t.lost };
    })
    .sort((a, b) => b.net - a.net);

  const myReady = game.summaryReady?.[room.mySeat];
  const allReady = (game.summaryReady || []).every(Boolean);

  const body = `
    <div class="settle-wrap">
      <div class="settle-hero">
        <div>
          <div class="sh-label">本 庄 结 束</div>
          <div style="font-size:13px;color:var(--text-dim);margin-top:8px;line-height:1.8">
            共进行 <b style="color:var(--gold-strong)">${game.roundsPlayed}</b> 局 ·
            牌墙剩余 ${game.wallLeft} 张<br />
            关闭统计面板后自动准备，由庄家决定连庄或移庄
          </div>
        </div>
        <div class="sh-split">
          <div class="sh-item">
            <div class="v" style="color:var(--text-dim)">${game.bigRound}</div>
            <div class="k">第 N 庄</div>
          </div>
        </div>
      </div>

      <div class="big-grid">
        ${rows.map(({ p, t, net }) => `
          <div class="big-row ${p.seat === room.mySeat ? 'is-me' : ''}">
            <span class="br-name">
              <span class="pod-avatar" style="width:22px;height:22px;font-size:10px">${escapeHTML(initials(p.name))}</span>
              ${escapeHTML(p.name)}
              ${p.seat === game.dealerSeat ? '<span class="pod-badge">庄</span>' : ''}
            </span>
            <span class="br-stat">胜 <b style="color:#7fd6a4">${t.won}</b></span>
            <span class="br-stat">负 <b style="color:#f09a89">${t.lost}</b></span>
            <span class="br-net ${net > 0 ? 'plus' : net < 0 ? 'minus' : 'zero'}">${net > 0 ? '+' : ''}${net} 杯</span>
          </div>`).join('')}
      </div>

      <div class="rule-line" style="color:var(--muted);font-size:12px">
        <span>统计口径：胜杯 = 该玩家从其他人处赢得的杯数；负杯 = 需要喝掉的杯数（单位：杯）。</span>
      </div>
    </div>`;

  openModal({
    title: '本庄统计',
    subtitle: `第 ${game.bigRound} 庄 · ${game.roundsPlayed} 局`,
    body,
    size: 'modal-wide',
    dismissible: false,
    footer: allReady
      ? '<span style="font-size:12.5px;color:var(--muted)">全员已关闭，等待庄家移庄…</span>'
      : `<button class="btn btn-primary" data-act="closeSummary" ${myReady ? 'disabled' : ''}>
           ${myReady ? '已关闭 · 等待他人' : '关闭并自动准备'}
         </button>`,
    onClose: () => markDismissed(key),
  });
}

function openPickModal(App, room, game, key) {
  const isDealer = room.mySeat === game.dealerSeat;
  const others = room.players.filter((p) => p.seat !== game.dealerSeat);

  const body = `
    <div class="settle-wrap">
      <div class="settle-hero" style="background:linear-gradient(140deg,rgba(212,176,106,.1),transparent)">
        <div>
          <div class="sh-label">移 庄</div>
          <div style="font-size:13px;color:var(--text-dim);margin-top:8px;line-height:1.8">
            ${isDealer
              ? '你可以选择连庄，或指定任意一位闲家成为新庄家。<br />确定后重新洗牌，开启新的大回合。'
              : `等待庄家 <b style="color:var(--gold-strong)">${escapeHTML(room.players[game.dealerSeat]?.name || '')}</b> 决定连庄或移庄。`}
          </div>
        </div>
      </div>
      ${isDealer ? `
      <div class="pick-grid">
        <div class="pick-item is-stay" data-act="pickDealer" data-seat="${room.mySeat}">
          <span class="pod-avatar" style="background:linear-gradient(145deg,#e8c887,#a9813f);color:#1a2416">庄</span>
          <span>
            <span style="font-size:13.5px;font-weight:500">连 庄</span>
            <span style="display:block;font-size:11px;color:var(--muted)">保持当前庄家不变</span>
          </span>
        </div>
        ${others.map((p) => `
          <div class="pick-item" data-act="pickDealer" data-seat="${p.seat}">
            <span class="pod-avatar">${escapeHTML(initials(p.name))}</span>
            <span>
              <span style="font-size:13.5px;font-weight:500">${escapeHTML(p.name)}</span>
              <span style="display:block;font-size:11px;color:var(--muted)">${p.isBot ? '机器人' : '闲家'}</span>
            </span>
          </div>`).join('')}
      </div>` : `
      <div class="wait-note" style="justify-content:center"><i class="spinner"></i>等待庄家选择…</div>`}
    </div>`;

  openModal({
    title: '移庄',
    subtitle: `第 ${game.bigRound} 庄结束`,
    body,
    size: 'modal-wide',
    dismissible: !isDealer,
    footer: isDealer ? '<button class="btn btn-ghost" data-close>稍后决定</button>' : '',
    onClose: () => markDismissed(key),
  });
}
