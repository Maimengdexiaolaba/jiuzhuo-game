import { toast, openModal, escapeHTML } from './ui.js';

export function mountLobby(App) {
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const res = await App.call('lobby:list', {});
    if (res.rooms) App.state.rooms = res.rooms;
    if (res.games) App.state.games = res.games;
    render(App);
    toast('房间列表已刷新', 'ok', 1200);
  });

  document.getElementById('btn-create').addEventListener('click', () => openCreateModal(App));

  document.getElementById('room-grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-join]');
    if (!btn) return;
    if (btn.disabled) return;
    const roomId = btn.dataset.join;
    btn.disabled = true;
    const res = await App.call('room:join', { roomId });
    btn.disabled = false;
    if (res.error) toast(res.error, 'error');
  });

  App.renderers.lobby = () => render(App);
}

function render(App) {
  const games = App.state.games || [];
  const rooms = App.state.rooms || [];
  const user = App.state.user;

  // 游戏条
  const strip = document.getElementById('game-strip');
  strip.innerHTML = games
    .map(
      (g) => `
      <div class="game-pill is-on">
        <span class="gp-icon">${escapeHTML(g.name.slice(0, 1))}</span>
        <span>
          <span class="gp-name">${escapeHTML(g.name)}</span>
          <span class="gp-tag">${escapeHTML(g.tagline)} · ${g.minPlayers}~${g.maxPlayers} 人</span>
        </span>
      </div>`
    )
    .join('');

  // 房间列表
  const grid = document.getElementById('room-grid');
  const empty = document.getElementById('lobby-empty');
  const sub = document.getElementById('lobby-sub');

  const openRooms = rooms.filter((r) => r.status === 'waiting' && r.playerCount < r.capacity).length;
  sub.textContent = rooms.length
    ? `共 ${rooms.length} 个房间 · ${openRooms} 个可加入 · 当前身份：${user?.isGuest ? '游客' : user?.displayName || ''}`
    : '当前没有房间，创建一间开始吧';

  if (!rooms.length) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  grid.innerHTML = rooms
    .map((r) => {
      const canJoin = r.status === 'waiting' && r.playerCount < r.capacity;
      const statusText = r.status === 'playing' ? '游戏中' : r.playerCount >= r.capacity ? '已满员' : '等待玩家';
      return `
      <article class="room-card">
        <div class="room-card-top">
          <div>
            <div class="room-id">房间 ${escapeHTML(r.id)}</div>
            <div class="room-game">${escapeHTML(r.gameName)}</div>
            <div class="room-host">房主 · ${escapeHTML(r.hostName)}</div>
          </div>
          <span class="status-dot ${r.status === 'playing' ? 'playing' : 'waiting'}">${statusText}</span>
        </div>
        <div class="room-meta">
          ${(r.configText || []).map((t) => `<span class="chip">${escapeHTML(t)}</span>`).join('')}
          ${r.bots ? `<span class="chip">机器人 ${r.bots}</span>` : ''}
        </div>
        <div class="room-card-foot">
          <span class="seat-meter"><b>${r.playerCount}</b> / ${r.capacity} 人</span>
          <button class="btn ${canJoin ? 'btn-primary' : 'btn-ghost'} btn-sm"
            data-join="${escapeHTML(r.id)}" ${canJoin ? '' : 'disabled'}>
            ${canJoin ? '加入房间' : r.status === 'playing' ? '观战中' : '已满员'}
          </button>
        </div>
      </article>`;
    })
    .join('');
}

/* ---------------- 创建房间 ---------------- */

function openCreateModal(App) {
  const games = App.state.games || [];
  if (!games.length) {
    toast('游戏列表加载中，请稍候', 'warn');
    return;
  }
  const prefs = App.state.user?.prefs || {};
  let selectedId = games.find((g) => g.id === prefs.lastGame)?.id || games[0].id;
  const values = {};

  const resetValues = (game) => {
    (game.configSchema || []).forEach((s) => {
      values[s.key] = s.default;
    });
    if (values.erbaMax !== undefined && prefs.erbaMax !== undefined) {
      values.erbaMax = !!prefs.erbaMax;
    }
    if (values.botFill !== undefined && prefs.botFill !== undefined) {
      values.botFill = !!prefs.botFill;
    }
  };

  const gameListHTML = games
    .map(
      (g) => `
      <div class="game-choice-item" data-game="${escapeHTML(g.id)}">
        <span class="gci-icon">${escapeHTML(g.name.slice(0, 1))}</span>
        <span style="flex:1">
          <span class="gci-name">${escapeHTML(g.name)}</span>
          <span class="gci-desc">${escapeHTML(g.description)}</span>
        </span>
      </div>`
    )
    .join('');

  const body = `
    <div>
      <div class="rules-box" style="background:transparent;border:0;padding:0 0 10px">
        <span class="rb-title">第一步 · 选择游戏类型</span>
      </div>
      <div class="game-choice" id="game-choice">${gameListHTML}</div>
    </div>
    <div>
      <div class="rules-box" style="background:transparent;border:0;padding:0 0 10px">
        <span class="rb-title">第二步 · 玩法配置</span>
      </div>
      <div class="config-block" id="config-block"></div>
    </div>
    <div class="rules-box" id="rules-box"></div>`;

  const { el, close } = openModal({
    title: '创建房间',
    subtitle: '选好游戏后会自动载入该游戏的专属参数',
    body,
    size: 'modal-wide',
    footer: `
      <button class="btn btn-ghost" data-close>取消</button>
      <button class="btn btn-primary" data-act="create">创建并进入</button>`,
  });

  const configBlock = el.querySelector('#config-block');
  const rulesBox = el.querySelector('#rules-box');

  function paintGame() {
    const game = games.find((g) => g.id === selectedId);
    el.querySelectorAll('.game-choice-item').forEach((n) => {
      n.classList.toggle('is-active', n.dataset.game === selectedId);
    });
    configBlock.innerHTML = (game.configSchema || [])
      .filter((s) => !s.showWhen || values[s.showWhen.key] === s.showWhen.equals)
      .map((s) => {
        if (s.type === 'enum') {
          return `
          <div class="config-row">
            <div>
              <div class="cr-label">${escapeHTML(s.label)}</div>
              <div class="cr-hint">${escapeHTML((s.options.find((o) => o.value === values[s.key]) || {}).desc || s.hint || '')}</div>
            </div>
            <div class="enum-group" data-enum="${s.key}">
              ${(s.options || []).map((o) => `
                <button type="button" class="enum-btn ${values[s.key] === o.value ? 'is-on' : ''}"
                        data-enum-key="${s.key}" data-enum-val="${o.value}">${escapeHTML(o.label)}</button>`).join('')}
            </div>
          </div>`;
        }
        if (s.type === 'number') {
          return `
          <div class="config-row">
            <div>
              <div class="cr-label">${escapeHTML(s.label)}</div>
              <div class="cr-hint">${escapeHTML(s.hint || '')}</div>
            </div>
            <div class="range-row">
              <input type="range" min="${s.min}" max="${s.max}" step="1"
                     value="${values[s.key]}" data-key="${s.key}" />
              <span class="range-val" data-val="${s.key}">${values[s.key]} 人</span>
            </div>
          </div>`;
        }
        return `
        <div class="config-row">
          <div>
            <div class="cr-label">${escapeHTML(s.label)}</div>
            <div class="cr-hint">${escapeHTML(s.hint || '')}</div>
          </div>
          <label class="switch">
            <input type="checkbox" data-key="${s.key}" ${values[s.key] ? 'checked' : ''} />
            <span class="track"></span>
          </label>
        </div>`;
      })
      .join('');

    // 按当前配置挑选对应的规则说明（支持按选项切换）
    let rules = game.rules || [];
    for (const v of game.rulesVariants || []) {
      const hit = Object.entries(v.match || {}).every(([k, val]) => String(values[k]) === String(val));
      if (hit) { rules = v.rules; break; }
    }

    rulesBox.innerHTML = `
      <span class="rb-title">牌型规则</span>
      ${rules
        .map((r) => `<div class="rule-line"><b>${escapeHTML(r.title)}</b><span>${escapeHTML(r.body)}</span></div>`)
        .join('')}`;
  }

  el.querySelector('#game-choice').addEventListener('click', (e) => {
    const item = e.target.closest('[data-game]');
    if (!item) return;
    selectedId = item.dataset.game;
    resetValues(games.find((g) => g.id === selectedId));
    paintGame();
  });

  configBlock.addEventListener('click', (e) => {
    const b = e.target.closest('[data-enum-key]');
    if (!b) return;
    values[b.dataset.enumKey] = b.dataset.enumVal;
    paintGame();
  });

  configBlock.addEventListener('input', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    if (e.target.type === 'range') {
      values[key] = Number(e.target.value);
      const label = el.querySelector(`[data-val="${key}"]`);
      if (label) label.textContent = `${values[key]} 人`;
    } else if (e.target.type === 'checkbox') {
      values[key] = e.target.checked;
      paintGame();
    }
  });

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act !== 'create') return;
    const btn = e.target.closest('[data-act]');
    btn.disabled = true;
    const res = await App.call('room:create', { gameId: selectedId, config: { ...values } });
    btn.disabled = false;
    if (res.error) {
      toast(res.error, 'error');
      return;
    }
    if (!App.state.user?.isGuest) {
      App.call('me:prefs', {
        lastGame: selectedId,
        erbaMax: !!values.erbaMax,
        botFill: !!values.botFill,
      });
    }
    close();
  });

  resetValues(games.find((g) => g.id === selectedId));
  paintGame();
}
