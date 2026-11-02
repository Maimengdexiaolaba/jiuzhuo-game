import { escapeHTML, initials, openModal, closeAllModals, toast } from './ui.js';
import { playCardHTML, backCardHTML } from './playcards.js';
import { sfx, speak } from './audio.js';

const PHASE_TEXT = {
  blind: '闷牌声明', dealer_change: '庄家换牌', bet: '叫酒', open: '开牌',
  settle: '本局结算', big_end: '本庄统计', dealer_pick: '移庄',
};

let modalKey = null;
let dismissed = false;
let lastRound = null;
let pickSeat = null;
let lastSeq = 0;

export function resetSupermengView() {
  modalKey = null;
  dismissed = false;
  lastRound = null;
  pickSeat = null;
  lastSeq = 0;
}

const nameOf = (room, seat) => room.players.find((p) => p.seat === seat)?.name || `座位${seat}`;

const cupUnit = (n) => `${n} 杯`;

/** 超级梦幻事件音效与播报 */
function handleSupermengEvents(g) {
  const ev = g?.lastEvent;
  if (!ev) return;
  if (!lastSeq) { lastSeq = ev.seq; return; }
  if (ev.seq <= lastSeq) return;
  lastSeq = ev.seq;

  if (ev.type === 'blind') {
    if (ev.blind) speak(['sm_blind']);
    else sfx.click();
  } else if (ev.type === 'bet') {
    speak(['sm_bet']);
  } else if (ev.type === 'lock') {
    sfx.yourTurn();
    speak(['sm_lock']);
  } else if (ev.type === 'openRequest') {
    sfx.click();
  } else if (ev.type === 'fold') {
    speak(['sm_fold']);
  } else if (ev.type === 'fight') {
    speak(['sm_fight']);
    // 比牌结果播报
    setTimeout(() => speak([ev.dealerWin ? 'sm_dealer_win' : 'sm_dealer_lose']), 900);
  } else if (ev.type === 'changeCards') {
    sfx.shuffle();
  } else if (ev.type === 'settle') {
    sfx.win();
  }
}

/* ---------------- 主牌桌 ---------------- */

export function supermengTableHTML(App, room) {
  const g = room.game;
  const me = room.mySeat;
  const meta = g.meta || {};
  const myHand = room.myHand || [];
  const isSpectator = !!room.isSpectator;

  handleSupermengEvents(g);

  return `
  <div class="felt felt-xihua felt-supermeng">
    ${smSeats(room, g)}
    <div class="xh-center">
      ${smCenter(room, g, meta)}
    </div>
    ${isSpectator
      ? '<div class="spectator-bar"><i class="pulse"></i>观 战 中 · 仅可见公共牌面</div>'
      : `<div class="xh-me">
      <div class="xh-my-bar">
        <span class="xh-my-title">我的手牌</span>
        <span class="xh-deck-tag">牌堆 <b>${g.deckLeft ?? 0}</b> / ${g.totalDeck ?? 0}</span>
        ${g.phase === 'bet' ? `<span class="xh-zone-tag">本轮 ${g.bets[me] ? `叫 <b>${g.bets[me]}</b> 杯` : '待叫酒'}</span>` : ''}
        ${g.locked ? `<span class="xh-zone-tag" style="color:#e8a67a">锁酒 <b>${g.locked.cups}</b> 杯</span>` : ''}
      </div>
      <div class="xh-hand">
        ${myHand.length
          ? myHand.map((c) => playCardHTML(c, { size: 'lg', meta: meta[c.rank], asset: 'supermeng' })).join('')
          : (me != null && g.handCounts?.[me] > 0
            ? Array.from({ length: g.handCounts[me] }, () => backCardHTML('lg', '', 'supermeng')).join('')
            : '<span class="xh-empty-hand">等待发牌</span>')}
        ${room.myHandInfo ? `<span class="sm-handinfo">${escapeHTML(room.myHandInfo.name)}</span>` : ''}
      </div>
      <div class="xh-actions">${smActions(room, g)}</div>
    </div>`}
  </div>`;
}

function smSeats(room, g) {
  return `
    <div class="xh-seats">
      ${room.players.map((p) => {
        const isDealer = p.seat === g.dealerSeat;
        const isTurn = (g.phase === 'bet' || g.phase === 'blind' || g.phase === 'open') && g.currentSeat === p.seat;
        const bet = g.bets?.[p.seat] || 0;
        const blind = g.blind?.[p.seat];
        const opened = g.opened?.[p.seat];
        const hand = p.hand;
        const info = p.handInfo;
        return `
        <div class="xh-seat ${isTurn ? 'is-turn' : ''} ${p.seat === room.mySeat ? 'is-me' : ''} ${isDealer ? 'is-dealer' : ''}">
          <div class="xh-seat-top">
            <span class="pod-avatar">${escapeHTML(initials(p.name))}</span>
            <span class="xh-seat-name">${escapeHTML(p.name)}</span>
            ${isDealer ? '<span class="pod-badge">庄</span>' : ''}
            ${blind ? '<span class="pod-badge sm-blind">闷</span>' : ''}
            ${p.isBot ? '<span class="pod-badge bot">AI</span>' : ''}
          </div>
          <div class="xh-seat-info">
            ${bet ? `<span class="sm-bet">叫 <b>${bet}</b> 杯</span>` : `<span class="xh-cards">牌 <b>${p.handCount ?? 2}</b></span>`}
            ${opened === 'fold' ? '<span class="sm-op fold">服</span>' : ''}
            ${opened === 'fight' ? '<span class="sm-op fight">不服</span>' : ''}
          </div>
          <div class="xh-mini-hand">
            ${hand && hand.length
              ? hand.map((c) => playCardHTML(c, { size: 'xs', meta: g.meta?.[c.rank], asset: 'supermeng' })).join('')
              : Array.from({ length: Math.min(p.handCount ?? 2, 2) }, () => backCardHTML('xs', '', 'supermeng')).join('')}
            ${info && (g.phase === 'settle' || g.phase === 'big_end') ? `<span class="sm-info">${escapeHTML(info.name)}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function smCenter(room, g, meta) {
  const dealer = g.dealerSeat;
  const phase = g.phase;
  const status = smStatus(room, g);

  let body = '';
  if (phase === 'open' && g.lastEvent?.type === 'fight') {
    // 比牌只显示输赢结果，不亮牌（牌面留到统计面板）
    const seatName = g.lastEvent.seatName || nameOf(room, g.lastEvent.seat);
    body = `<div class="sm-fight">
      <div class="sm-fight-result ${g.lastEvent.dealerWin ? 'win' : 'lose'}">
        ${g.lastEvent.dealerWin ? '庄家胜' : '庄家负'}
      </div>
      <div class="sm-fight-sub">
        ${g.lastEvent.dealerWin
          ? `闲家 ${escapeHTML(seatName)} 不服落败`
          : `闲家 ${escapeHTML(seatName)} 不服胜出`}
      </div>
    </div>`;
  } else {
    body = `
      <div class="xh-table-empty">
        <span>${escapeHTML(status.line)}</span>
        <small>${escapeHTML(status.sub)}</small>
      </div>`;
  }

  return body;
}

function smStatus(room, g) {
  const me = room.mySeat;
  const phase = g.phase;
  const cur = g.currentSeat;
  if (phase === 'blind') {
    return cur === me ? { line: '轮到你声明', sub: '选择闷牌或看牌' } : { line: `等待 ${nameOf(room, cur)} 声明`, sub: '闷牌声明阶段' };
  }
  if (phase === 'dealer_change') {
    return cur === me ? { line: '你可以选择换牌', sub: '两张手牌全换，喝 1 杯' } : { line: '庄家正在决定是否换牌', sub: '' };
  }
  if (phase === 'bet') {
    return cur === me ? { line: '轮到你叫酒', sub: `叫 1~${g.config.betMax} 杯` } : { line: `等待 ${nameOf(room, cur)} 叫酒`, sub: g.locked ? `已锁酒 ${g.locked.cups} 杯` : '从庄家下家顺时针叫' };
  }
  if (phase === 'open') {
    if (g.openSeat !== null) return { line: `等待 ${nameOf(room, g.openSeat)} 回应`, sub: '服（喝所押）/ 不服（比牌翻倍）' };
    return cur === me ? { line: '轮到你开牌', sub: '选择要开的闲家，或结束开牌' } : { line: '庄家正在开牌', sub: `剩牌 ${g.deckLeft} 张` };
  }
  if (phase === 'settle') return { line: '本局结算', sub: `第 ${g.roundNo} 局 · 剩牌 ${g.deckLeft} 张` };
  if (phase === 'big_end') return { line: '本庄结束', sub: '查看统计后进入移庄' };
  if (phase === 'dealer_pick') return { line: '移庄', sub: '庄家选择新庄家，新庄家可重设规则' };
  return { line: '', sub: '' };
}

function smActions(room, g) {
  const me = room.mySeat;
  const phase = g.phase;

  if (phase === 'blind') {
    if (g.currentSeat !== me) return `<span class="wait-note"><i class="spinner"></i>等待 ${escapeHTML(nameOf(room, g.currentSeat))} 声明</span>`;
    return `
      <button class="btn btn-primary" data-act="blindChoice" data-blind="1">闷 牌</button>
      <button class="btn btn-ghost" data-act="blindChoice" data-blind="0">看 牌</button>
      <div class="action-tip">闷牌 = 本局不看牌押酒；庄家看牌开闷牌闲家输赢翻倍更狠</div>`;
  }

  if (phase === 'dealer_change') {
    if (g.currentSeat !== me) return `<span class="wait-note"><i class="spinner"></i>庄家正在决定</span>`;
    const left = g.dealerChangeLeft ?? 0;
    return `
      ${left > 0 ? `<button class="btn btn-primary" data-act="changeCards">换 牌（喝 1 杯）</button>` : ''}
      <button class="btn btn-ghost" data-act="skipChange">不 换</button>
      <div class="action-tip">本庄还能换 ${left} 手 · 两张全换</div>`;
  }

  if (phase === 'bet') {
    if (g.currentSeat !== me) return `<span class="wait-note"><i class="spinner"></i>等待 ${escapeHTML(nameOf(room, g.currentSeat))} 叫酒</span>`;
    const max = g.config.betMax;
    const isTail = g.betOrder?.length && g.betOrder[g.betOrder.length - 1] === me;
    const firstCups = g.betOrder?.length ? g.bets?.[g.betOrder[0]] : 0;
    return `
      <div class="action-row">
        ${Array.from({ length: max }, (_, i) => i + 1)
          .map((n) => `<button class="btn ${n === 2 || n === 3 ? 'btn-ghost' : 'btn-primary'}" data-act="bet" data-cups="${n}">叫 ${n} 杯</button>`)
          .join('')}
      </div>
      ${isTail && (firstCups === 2 || firstCups === 3)
        ? `<div class="action-row"><button class="btn btn-ghost" data-act="lock">锁 定 ${firstCups} 杯（全场）</button></div>`
        : ''}
      <div class="action-tip">首家已叫 ${firstCups || '—'} 杯${isTail ? ' · 你是尾家，可锁全场' : ''}</div>`;
  }

  if (phase === 'open') {
    if (g.openSeat !== null) {
      if (g.openSeat !== me) return `<span class="wait-note"><i class="spinner"></i>等待 ${escapeHTML(nameOf(room, g.openSeat))} 回应</span>`;
      return `
        <button class="btn btn-ghost" data-act="fold">服 · 喝 ${g.bets[me]} 杯</button>
        <button class="btn btn-primary" data-act="fight">不 服 · 比牌（输者翻倍）</button>
        <div class="action-tip">不服则与庄家比牌，输者喝所押酒双倍${g.blind?.[me] ? '（你是闷牌）' : ''}</div>`;
    }
    if (g.currentSeat !== me) return `<span class="wait-note"><i class="spinner"></i>等待庄家开牌</span>`;
    const cands = room.players.filter((p) => p.seat !== g.dealerSeat && !g.opened?.[p.seat]);
    const canPeek = g.blind?.[me] && !g.dealerSawOwn;
    return `
      ${canPeek ? `<div class="action-row"><button class="btn btn-ghost" data-act="peek">看 牌（看自己的牌）</button></div>` : ''}
      <div class="action-row">
        ${cands.map((p) => `<button class="btn btn-ghost btn-sm" data-act="open" data-seat="${p.seat}">开 ${escapeHTML(p.name)}（叫 ${g.bets?.[p.seat] || 0} 杯）</button>`).join('')}
      </div>
      ${g.canStop ? `<div class="action-row"><button class="btn btn-primary" data-act="stopOpen">结束开牌</button></div>` : ''}
      <div class="action-tip">庄家至少开一家，也可继续开其他闲家</div>`;
  }

  if (phase === 'settle') {
    if (g.currentSeat !== me && g.dealerSeat !== me) return `<div class="action-row"><button class="btn btn-ghost" data-act="smSettle">本局结算</button></div><div class="action-tip">等待庄家开启下一局</div>`;
    return `
      <button class="btn btn-primary btn-lg" data-act="nextRound">开 始 下 一 局</button>
      <button class="btn btn-ghost" data-act="smSettle">本局结算</button>`;
  }

  if (phase === 'big_end') {
    // 本庄统计：庄家点「关闭统计」进入移庄；闲家可看统计
    const isDealer = g.dealerSeat === me;
    return `
      <button class="btn btn-ghost" data-act="smBigStats">本庄统计</button>
      ${isDealer
        ? `<button class="btn btn-primary" data-act="closeSummary">关闭统计 · 进入移庄</button>`
        : '<div class="action-tip">等待庄家关闭统计进入移庄</div>'}`;
  }

  if (phase === 'dealer_pick') {
    const target = g.newDealerSeat;
    return `
      <button class="btn btn-ghost" data-act="smBigStats">本庄统计</button>
      ${target === null && g.dealerSeat === me
        ? `<div class="action-row" style="width:100%;justify-content:center">${room.players.map((p) => `<button class="btn btn-ghost btn-sm" data-act="pickDealer" data-seat="${p.seat}">${p.seat === me ? '连庄（保持）' : '庄家 → ' + escapeHTML(p.name)}</button>`).join('')}</div>`
        : target === me
          ? `<div class="action-row" style="width:100%;justify-content:center">
               <button class="btn btn-ghost" data-act="smConfig">重设规则（可选）</button>
               <button class="btn btn-primary" data-act="smStartBig">沿用原规则 · 开局</button>
             </div>`
          : target !== null
            ? `<div class="action-tip">等待新庄家 ${escapeHTML(nameOf(room, target))} 确认</div>`
            : '<div class="action-tip">等待庄家选择新庄家</div>'}`;
  }

  return '';
}

/* ---------------- 结算 / 统计 / 移庄弹窗 ---------------- */

export function syncSupermengModal(App, room) {
  const g = room.game;
  if (!g) return;
  if (g.phase !== 'settle' && g.phase !== 'big_end') {
    if (modalKey) { closeAllModals(); modalKey = null; }
    dismissed = false;
    return;
  }
  const key = `${g.phase}:${g.roundNo}`;
  if (lastRound !== g.roundNo) { lastRound = g.roundNo; dismissed = false; }
  if (dismissed || key === modalKey) return;
  modalKey = key;
  if (g.phase === 'settle') openSettleModal(App, room, g);
  else openBigEndModal(App, room, g);
}

function openSettleModal(App, room, g) {
  const res = g.results;
  if (!res) return;
  const d = res.dealer;
  const dealerName = nameOf(room, g.dealerSeat);
  const meta = g.meta || {};

  const rows = res.rows.map((r) => {
    const blind = r.blind ? '<span class="pod-badge sm-blind">闷</span>' : '';
    const outcomeText = r.outcome === 'fold' ? '服' : r.outcome === 'win' ? '赢庄' : '输庄';
    const oc = r.outcome === 'win' ? 'num-win' : 'num-lose';
    const cups = r.seatCups; // 闲家自己喝的杯（赢则为 0）
    return `
      <tr class="${r.outcome === 'win' ? 'is-win' : ''}">
        <td data-label="闲家"><span class="st-name">${blind}${escapeHTML(nameOf(room, r.seat))}</span></td>
        <td data-label="手牌"><span class="st-hand">${r.hand.map((c) => playCardHTML(c, { size: 'xs', meta: meta[c.rank], asset: 'supermeng' })).join('')}</span></td>
        <td data-label="牌型"><span class="hand-tag">${escapeHTML(r.handName)}</span></td>
        <td data-label="押酒">${r.bet} 杯</td>
        <td data-label="结果" class="${oc}">${outcomeText}</td>
        <td data-label="喝杯" class="${cups ? 'num-lose' : 'num-zero'}"><b>${cups}</b> 杯</td>
      </tr>`;
  }).join('');

  const body = `
    <div class="settle-wrap">
      <div class="settle-hero">
        <div>
          <div class="sh-label">庄 家 汇 总 · ${escapeHTML(dealerName)}${d.blind ? '（闷）' : ''}</div>
          <div class="sh-main">
            <span class="sh-num" style="color:#7fd6a4">${d.won}</span><span class="sh-unit">杯 胜 &nbsp;/&nbsp;</span>
            <span class="sh-num" style="color:#f09a89">${d.lost}</span><span class="sh-unit">杯 负</span>
          </div>
        </div>
        <div class="sh-split">
          <div class="sh-item net"><div class="v">${d.net > 0 ? '+' : ''}${d.net}</div><div class="k">净胜负</div></div>
          <div class="sh-item"><div class="v">${escapeHTML(d.handName)}</div><div class="k">庄家牌型</div></div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="settle-table sm-settle-table">
          <thead><tr><th>闲家</th><th>手牌</th><th>牌型</th><th>押酒</th><th>结果</th><th>喝杯</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${res.locked ? `<div class="rule-line" style="color:#e8a67a"><span>锁酒持续：全场 ${res.locked.cups} 杯（庄家同时赢首尾两家才解锁）</span></div>` : ''}
      ${d.selfPenalty ? `<div class="rule-line" style="color:var(--muted)"><span>庄家换牌自罚 ${d.selfPenalty} 杯已计入。</span></div>` : ''}
    </div>`;

  openModal({
    title: '本局结算',
    subtitle: `第 ${g.roundNo} 局 · 剩牌 ${g.deckLeft} 张`,
    body,
    size: 'modal-xl',
    footer: '<button class="btn btn-ghost" data-close>关闭</button>',
    onClose: () => { dismissed = true; },
  });
}

function openBigEndModal(App, room, g) {
  const stats = g.bigStats;
  const rows = stats
    ? stats.rows.map((s, i) => `<tr><td data-label="玩家"><span class="st-name">${escapeHTML(nameOf(room, i))}${i === g.dealerSeat ? ' <span class="pod-badge">庄</span>' : ''}</span></td><td data-label="局数">${s.rounds} 局</td><td data-label="胜杯" class="num-win">${s.won}</td><td data-label="负杯" class="num-lose">${s.lost}</td><td data-label="净胜负" class="${s.net > 0 ? 'num-win' : s.net < 0 ? 'num-lose' : 'num-zero'}">${s.net > 0 ? '+' : ''}${s.net}</td></tr>`).join('')
    : '';

  const body = `
    <div class="table-scroll">
      <table class="settle-table">
        <thead><tr><th>玩家</th><th>局数</th><th>胜杯</th><th>负杯</th><th>净胜负</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="rule-line" style="color:var(--muted)"><span>剩牌不足发一轮，进入移庄。移庄后重新洗牌开新大回合。</span></div>`;

  openModal({
    title: '本庄统计',
    subtitle: `共 ${g.bigStats?.rounds || 0} 局`,
    body,
    size: 'modal-xl',
    footer: '<button class="btn btn-ghost" data-close>关闭</button>',
    onClose: () => { dismissed = true; },
  });
}

export function reopenSupermengSettle(App, room) {
  const g = room.game;
  if (g.phase === 'settle') openSettleModal(App, room, g);
  else if (g.phase === 'big_end') openBigEndModal(App, room, g);
}

/* ---------------- 历史回放 ---------------- */

export function openSupermengHistory(App, room) {
  const g = room.game;
  const history = g.history || [];
  const meta = g.meta || {};

  const body = history.length
    ? `<div class="hist-list">
        ${history.slice().reverse().map((h) => {
          const res = h.results;
          const d = res.dealer;
          const rows = res.rows.map((r) => {
            const blind = r.blind ? '<span class="pod-badge sm-blind">闷</span>' : '';
            const outcomeText = r.outcome === 'fold' ? '服' : r.outcome === 'win' ? '赢庄' : '输庄';
            return `
              <tr>
                <td><span class="st-name">${blind}${escapeHTML(nameOf(room, r.seat))}</span></td>
                <td><span class="st-hand">${r.hand.map((c) => playCardHTML(c, { size: 'xs', meta: meta[c.rank], asset: 'supermeng' })).join('')}</span></td>
                <td><span class="hand-tag">${escapeHTML(r.handName)}</span></td>
                <td>${r.bet} 杯</td>
                <td class="${r.outcome === 'win' ? 'num-win' : 'num-lose'}">${outcomeText}</td>
                <td class="num-lose">${r.seatCups || 0} 杯</td>
              </tr>`;
          }).join('');
          return `
          <details class="hist-round">
            <summary>
              <span class="hr-no">第 ${h.roundNo} 局</span>
              <span class="hr-meta">庄家 ${escapeHTML(nameOf(room, h.dealerSeat))}</span>
              <span class="hr-score">庄 胜 <b class="num-win">${d.won}</b> · 负 <b class="num-lose">${d.lost}</b></span>
            </summary>
            <div class="hr-body">
              <div class="table-scroll">
                <table class="settle-table">
                  <thead><tr><th>闲家</th><th>手牌</th><th>牌型</th><th>押酒</th><th>结果</th><th>喝杯</th></tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            </div>
          </details>`;
        }).join('')}
      </div>
      <div class="rule-line" style="color:var(--muted);font-size:12px"><span>仅回放本庄已完成的 ${history.length} 局，移庄后清空。</span></div>`
    : '<div class="empty-state" style="margin:0;padding:44px 20px"><p>还没有可回放的牌局</p></div>';

  openModal({
    title: '历史回放',
    subtitle: `第 ${g.bigRound} 庄 · 已完成 ${history.length} 局`,
    body,
    size: 'modal-xl',
    footer: '<button class="btn btn-ghost" data-close>关闭</button>',
  });
}

/* ---------------- 移庄重设规则 ---------------- */

export function openSupermengConfig(App, room) {
  const g = room.game;
  const cur = g.config || {};
  const schema = (App.state.games || []).find((x) => x.id === 'supermeng')?.configSchema || [];
  const items = schema
    .filter((s) => s.type !== 'number' && !s.showWhen || (s.type !== 'number' && (!s.showWhen || cur[s.showWhen.key] === s.showWhen.equals)))
    .map((s) => {
      if (s.type === 'enum') {
        return `<div class="config-row"><div><div class="cr-label">${escapeHTML(s.label)}</div></div>
          <div class="enum-group">${(s.options || []).map((o) => `<button type="button" class="enum-btn ${cur[s.key] === o.value ? 'is-on' : ''}" data-cfg="${s.key}" data-val="${o.value}">${escapeHTML(o.label)}</button>`).join('')}</div></div>`;
      }
      return `<div class="config-row"><div><div class="cr-label">${escapeHTML(s.label)}</div><div class="cr-hint">${escapeHTML(s.hint || '')}</div></div>
        <label class="switch"><input type="checkbox" data-cfg="${s.key}" ${cur[s.key] ? 'checked' : ''} /><span></span></label></div>`;
    }).join('');

  const { el, close } = openModal({
    title: '重设规则（可选）',
    subtitle: '不改直接「沿用原规则开局」',
    body: `<div id="sm-cfg-block">${items}</div>`,
    footer: `
      <button class="btn btn-ghost" data-act="smStartBig">沿用原规则开局</button>
      <button class="btn btn-primary" data-act="smApplyConfig">按新规则开局</button>`,
  });

  const cfg = { ...cur };
  el.querySelector('#sm-cfg-block').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cfg]');
    if (!btn) return;
    if (btn.dataset.val !== undefined) cfg[btn.dataset.cfg] = btn.dataset.val;
    else {
      const box = btn.querySelector('input');
      cfg[btn.dataset.cfg] = box.checked;
    }
    el.querySelectorAll('[data-cfg]').forEach((b) => {
      if (b.dataset.val !== undefined) b.classList.toggle('is-on', cfg[b.dataset.cfg] === b.dataset.val);
    });
  });

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const apply = btn.dataset.act === 'smApplyConfig';
    close();
    const res = await App.call('game:action', { type: 'startBigRound', payload: apply ? { config: cfg } : {} });
    if (res.error) toast(res.error, 'error');
  });
}
