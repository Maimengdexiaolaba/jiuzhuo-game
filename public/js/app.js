import { toast, closeAllModals, escapeHTML } from './ui.js';
import { openStatsModal } from './stats.js';
import { openShopModal } from './shop.js';
import { setAudioEnabled, setBgmMood, isBgmPlaying, getBgmMood } from './audio.js';
import { mountAuth } from './auth.js';
import { mountLobby } from './lobby.js';
import { mountRoom } from './room.js';
import { mountAdmin } from './admin.js';
import { clearFx } from './fx.js';

const socket = window.io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 600,
  reconnectionDelayMax: 4000,
});

const TOKEN_KEY = 'jz_token';
const ROOM_KEY = 'jz_room';

function readToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
}

function writeToken(token) {
  if (!token) {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    return;
  }
  // 游客 token 只存在当前标签页，关闭标签页即失效
  if (token.startsWith('g_')) {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
  } else {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

const App = {
  socket,
  state: {
    user: null,
    token: readToken(),
    rooms: [],
    games: [],
    room: null,
    view: 'auth',
    pendingRoom: localStorage.getItem(ROOM_KEY) || null,
    restored: false,
    soundOn: localStorage.getItem('jz_sound') !== '0',
  },
  renderers: {},
  call(event, payload = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ error: '网络响应超时，请检查连接' });
      }, 12000);
      socket.emit(event, payload, (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res || {});
      });
    });
  },
  navigate(name) {
    const views = ['auth', 'lobby', 'room', 'admin'];
    views.forEach((v) => {
      const el = document.getElementById(`view-${v}`);
      if (el) el.hidden = v !== name;
    });
    App.state.view = name;
    // 背景音乐随场景切换：牌局用战斗版，其余用平静版
    setBgmMood(name === 'room' ? 'room' : name === 'admin' ? null : 'lobby');
    // 牌桌视图锁成整屏，避免手机地址栏占用高度把手牌推出屏幕
    document.body.classList.toggle('in-room', name === 'room');
    App.renderTopbar();
    const fn = App.renderers[name];
    if (fn) fn();
  },
  renderTopbar,
  async logout() {
    await App.call('auth:logout', { token: App.state.token });
    writeToken(null);
    localStorage.removeItem(ROOM_KEY);
    App.state.token = null;
    App.state.user = null;
    App.state.room = null;
    App.state.pendingRoom = null;
    App.state.restored = true;
    closeAllModals();
    clearFx();
    App.navigate('auth');
  },
};

/* ---------------- 顶栏 ---------------- */

function renderTopbar() {
  const host = document.getElementById('topbar-actions');
  if (!host) return;
  const { user } = App.state;

  if (!user) {
    host.innerHTML = '';
    return;
  }

  const role = user.isGuest
    ? '游客'
    : user.isAdmin
      ? (user.displayName === '管理员' ? '超级管理员' : '管理员')
      : '家庭成员';

  host.innerHTML = `
    ${user.isGuest ? '' : '<button class="btn btn-ghost btn-sm" id="btn-my-stats"><span class="lf">我的战绩</span><span class="ls">战绩</span></button>'}
    ${user.isGuest ? '' : '<button class="btn btn-ghost btn-sm" id="btn-shop"><span class="lf">积分商城</span><span class="ls">商城</span></button>'}
    ${user.isAdmin ? '<button class="btn btn-ghost btn-sm" id="btn-goto-admin"><span class="lf">管理后台</span><span class="ls">后台</span></button>' : ''}
    <button class="btn btn-ghost btn-sm" id="btn-sound" title="音效 / 背景音乐开关">${App.state.soundOn ? '🔊' : '🔇'}</button>
    <div class="user-chip">
      <span class="avatar">${escapeHTML((user.displayName || '客').slice(0, 1))}</span>
      <span>
        <span class="u-name">${escapeHTML(user.displayName)}</span>
        <span class="u-role">${role}</span>
      </span>
    </div>
    <button class="btn btn-ghost btn-sm" id="btn-logout">退出</button>`;

  host.querySelector('#btn-logout')?.addEventListener('click', () => App.logout());
  host.querySelector('#btn-goto-admin')?.addEventListener('click', () => App.navigate('admin'));
  host.querySelector('#btn-my-stats')?.addEventListener('click', () => openStatsModal(App));
  host.querySelector('#btn-shop')?.addEventListener('click', () => openShopModal(App));
  host.querySelector('#btn-sound')?.addEventListener('click', () => {
    App.state.soundOn = !App.state.soundOn;
    localStorage.setItem('jz_sound', App.state.soundOn ? '1' : '0');
    setAudioEnabled(App.state.soundOn);
    App.renderTopbar();
  });
}

/* ---------------- 首页游戏库 ---------------- */

const HERO_LIMIT = 3;

function pickHeroGames(all) {
  if (all.length <= HERO_LIMIT) return all;
  const pool = all.slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, HERO_LIMIT);
}

function renderHeroGames() {
  const host = document.getElementById('hero-games');
  if (!host) return;
  const games = App.state.games || [];

  // 超过 3 款时每次进页面随机挑 3 款展示，避免首页越堆越长
  if (!App.state.heroPicks || App.state.heroPicks.length !== Math.min(games.length, HERO_LIMIT)) {
    App.state.heroPicks = pickHeroGames(games);
  }
  const shown = App.state.heroPicks.length ? App.state.heroPicks : games;

  const live = shown
    .map(
      (g) => `
      <div class="hero-game is-live">
        <span class="hg-icon">${escapeHTML(g.name.slice(0, 1))}</span>
        <span class="hg-body">
          <span class="hg-name">${escapeHTML(g.name)}</span>
          <span class="hg-desc">${escapeHTML(g.tagline)} · ${g.minPlayers}~${g.maxPlayers} 人</span>
        </span>
        <span class="hg-state">可开桌</span>
      </div>`
    )
    .join('');

  const more = `
    <div class="hero-game is-soon">
      <span class="hg-icon">＋</span>
      <span class="hg-body">
        <span class="hg-name">更多游戏 敬请期待</span>
        <span class="hg-desc">新玩法持续排期开发中</span>
      </span>
      <span class="hg-state">规划中</span>
    </div>`;

  host.innerHTML = live + more;
}

/* ---------------- socket ---------------- */

function bindSocket() {
  socket.on('connect', async () => {
    if (App.state.token && !App.state.restored) {
      const res = await App.call('auth:restore', { token: App.state.token });
      if (res.error) {
        writeToken(null);
        App.state.token = null;
        App.state.user = null;
        App.state.restored = true;
        App.navigate('auth');
        return;
      }
      App.state.restored = true;
    } else if (App.state.user && App.state.room) {
      // 断线重连后回到房间
      const res = await App.call('room:join', { roomId: App.state.room.id });
      if (res.error) {
        localStorage.removeItem(ROOM_KEY);
        App.state.room = null;
        App.navigate('lobby');
      }
    }
  });

  socket.on('disconnect', () => {
    if (App.state.view === 'room') toast('连接断开，正在重连…', 'warn');
  });

  socket.on('auth:ok', (payload) => {
    const first = !App.state.user;
    App.state.user = payload.user;
    if (payload.token) {
      App.state.token = payload.token;
      writeToken(payload.token);
    }
    App.state.restored = true;
    App.renderTopbar();
    if (first) enterLobby();
  });

  socket.on('auth:required', () => {
    App.state.user = null;
    App.navigate('auth');
  });

  socket.on('lobby:rooms', (rooms) => {
    App.state.rooms = rooms || [];
    if (App.state.view === 'lobby') App.renderers.lobby?.();
  });

  socket.on('lobby:games', (games) => {
    App.state.games = games || [];
    renderHeroGames();
    if (App.state.view === 'lobby') App.renderers.lobby?.();
  });

  socket.on('room:state', (room) => {
    App.state.room = room;
    localStorage.setItem(ROOM_KEY, room.id);
    if (App.state.view !== 'room') {
      App.navigate('room');
    } else {
      App.renderers.room?.();
    }
  });

  socket.on('room:kicked', () => {
    toast('你已被房主请离房间', 'warn');
    leaveRoomLocal();
  });

  socket.on('toast', (payload) => {
    if (payload?.message) toast(payload.message, payload.type || 'info');
  });
}

async function enterLobby() {
  const pending = App.state.pendingRoom || localStorage.getItem(ROOM_KEY);
  if (pending) {
    const res = await App.call('room:join', { roomId: pending });
    if (!res.error) return;
    localStorage.removeItem(ROOM_KEY);
    App.state.pendingRoom = null;
  }
  App.navigate('lobby');
}

export function leaveRoomLocal() {
  localStorage.removeItem(ROOM_KEY);
  App.state.pendingRoom = null;
  App.state.room = null;
  closeAllModals();
  clearFx();
  App.navigate('lobby');
}

App.leaveRoomLocal = leaveRoomLocal;

/* ---------------- 启动 ---------------- */

mountAuth(App);
mountLobby(App);
mountRoom(App);
mountAdmin(App);

bindSocket();
renderHeroGames();
setAudioEnabled(App.state.soundOn);
App.navigate('auth');

// 若本地有登录态，等 restore 结果；无则展示登录页
if (!App.state.token) {
  App.state.restored = true;
}

window.App = App;
// 自检/调试用：BGM 状态与控制
App.bgm = { set: setBgmMood, playing: isBgmPlaying, mood: getBgmMood };
export default App;
