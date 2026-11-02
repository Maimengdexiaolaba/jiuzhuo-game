/**
 * 游戏音效引擎
 * - 基础音效用 Web Audio 实时合成（无需外部文件）
 * - 背景音乐（BGM）用 Web Audio 实时合成中式五声音阶循环（无需外部素材）
 * - 语音播报用预合成的 mp3（edge-tts 生成，/assets/audio/voice/*.mp3）
 * - 支持全局开关
 */

let ctx = null;
let enabled = true;

const VOICE_BASE = '/assets/audio/voice';

export function setAudioEnabled(v) {
  const wasEnabled = enabled;
  enabled = !!v;
  if (!enabled) {
    stopVoice();
    stopBgm();
  } else if (!wasEnabled) {
    startBgm(bgmWant);
  }
}

export function isAudioEnabled() {
  return enabled;
}

function ac() {
  if (!ctx) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    } catch (e) {
      ctx = null;
    }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur = 0.12, type = 'sine', gain = 0.18, delay = 0) {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur = 0.15, gain = 0.12, delay = 0) {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const buffer = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const g = c.createGain();
  g.gain.value = gain;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t0);
}

/* ---------------- 基础音效 ---------------- */

export const sfx = {
  click() { tone(660, 0.06, 'sine', 0.1); },
  shuffle() { noise(0.5, 0.2); },
  dice() { for (let i = 0; i < 6; i += 1) tone(300 + Math.random() * 300, 0.05, 'square', 0.08, i * 0.07); },
  deal() { tone(520, 0.07, 'triangle', 0.14); tone(660, 0.06, 'triangle', 0.12, 0.06); },
  play() { tone(440, 0.08, 'triangle', 0.15); },
  reveal() { tone(880, 0.12, 'sine', 0.14); tone(1100, 0.1, 'sine', 0.12, 0.08); },
  cut() { noise(0.1, 0.14); },
  bet() { tone(560, 0.07, 'sine', 0.14); tone(700, 0.08, 'sine', 0.12, 0.07); },
  penalty() { tone(220, 0.18, 'sawtooth', 0.12); tone(180, 0.18, 'sawtooth', 0.1, 0.12); },
  win() { tone(523, 0.12, 'sine', 0.16); tone(659, 0.12, 'sine', 0.16, 0.1); tone(784, 0.2, 'sine', 0.16, 0.2); },
  lose() { tone(392, 0.14, 'sine', 0.14); tone(330, 0.16, 'sine', 0.14, 0.12); },
  yourTurn() { tone(784, 0.1, 'sine', 0.14); tone(988, 0.14, 'sine', 0.14, 0.1); },
  moveDealer() { tone(440, 0.1, 'triangle', 0.13); tone(587, 0.14, 'triangle', 0.13, 0.1); },
};

/* ---------------- 语音播报 ---------------- */

// 预加载的 AudioBuffer 缓存：首次播报时 decode，之后无缝衔接
const voiceCache = new Map();
const voiceLoading = new Map();

async function loadVoiceBuffer(name) {
  if (voiceCache.has(name)) return voiceCache.get(name);
  if (voiceLoading.has(name)) return voiceLoading.get(name);
  const c = ac();
  if (!c) return null;
  const url = `${VOICE_BASE}/${name}.mp3`;
  const p = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((buf) => c.decodeAudioData(buf))
    .then((audioBuf) => { voiceCache.set(name, audioBuf); return audioBuf; })
    .catch(() => null)
    .finally(() => voiceLoading.delete(name));
  voiceLoading.set(name, p);
  return p;
}

// 正在播放的语音源（用于 stopVoice）
const activeSources = new Set();

/** 队列：用于按顺序拼接多条语音（无缝衔接，间隔极短） */
let voiceQueue = [];
let voiceChainBusy = false;

async function flushVoiceChain() {
  if (voiceChainBusy) return;
  voiceChainBusy = true;
  const c = ac();
  try {
    while (voiceQueue.length) {
      const name = voiceQueue.shift();
      const buf = await loadVoiceBuffer(name);
      if (!buf) continue;
      if (!enabled) { voiceQueue = []; break; }
      if (!c || c.state === 'closed') break;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      activeSources.add(src);
      src.start();
      // 等这条播完再播下一条（无缝：下一条已预解码，间隔仅调度开销）
      await new Promise((resolve) => { src.onended = () => { activeSources.delete(src); resolve(); }; });
    }
  } finally {
    voiceChainBusy = false;
  }
}

export function speak(parts) {
  if (!enabled) return;
  const list = Array.isArray(parts) ? parts : [parts];
  const names = list.filter(Boolean).map((p) => String(p));
  // 预取，让衔接时已经解码好
  names.forEach(loadVoiceBuffer);
  voiceQueue.push(...names);
  flushVoiceChain();
}

export function stopVoice() {
  voiceQueue = [];
  for (const src of activeSources) {
    try { src.stop(); } catch (e) { /* noop */ }
  }
  activeSources.clear();
}

/* 西游记：完整播报「数量+量词+角色」单条语音（如「一只猪八戒」），连续无停顿 */
export function speakXihuaPlay(count, roleKey) {
  const num = Math.min(4, Math.max(1, count));
  speak([`xh_${num}_${roleKey}`]);
}

export function speakXihuaPass() {
  speak(['xh_pass']);
}

/* ---------------- 背景音乐（BGM） ---------------- */
/**
 * 无外部素材：用 Web Audio 实时合成「中式五声音阶」循环，避免版权与下载依赖。
 * 场景：
 *   lobby —— 大厅/登录页，古筝散板 + 低音垫，平静舒缓
 *   room  —— 牌局，快节奏拨弦 + 鼓点，紧张
 * 调用：setBgmMood('lobby' | 'room' | null)
 */

// 五声音阶（宫商角徵羽）C D E G A，跨两个八度
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
const BGM_VOLUME = 0.5;
const BGM_LOOKAHEAD = 0.28;
const BGM_TICK = 60;

const BGM_PRESET = {
  lobby: {
    stepDur: 0.46,
    pluckDur: 1.9,
    pluckGain: 0.16,
    bassEvery: 8,
    bassGain: 0.1,
    // 32 步 = 约 14.7s 一循环；null = 留白
    melody: [
      0, null, 2, null, 4, null, null, 2,
      3, null, 2, null, 0, null, null, null,
      4, null, 6, null, 5, null, 4, null,
      2, null, 3, null, 0, null, null, null,
    ],
  },
  room: {
    stepDur: 0.2,
    pluckDur: 0.55,
    pluckGain: 0.13,
    bassEvery: 4,
    bassGain: 0.11,
    drum: true,
    drumGain: 0.42,
    clap: true,
    clapGain: 0.1,
    melody: [
      0, 2, 4, null, 5, 4, 2, 4,
      3, null, 2, 4, 5, null, 4, 2,
      6, 5, 4, null, 2, 3, 4, 5,
      7, 5, 4, 2, 0, null, 2, null,
    ],
  },
};

// 牌局鼓点：低音鼓 + 木鱼声，4/4 循环
const BGM_DRUM = [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const BGM_CLAP = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];

let bgmCtx = null;
let bgmMaster = null;
let bgmTimer = null;
let bgmNext = 0;
let bgmStep = 0;
let bgmMood = null;   // 正在播放的场景
let bgmWant = null;   // 期望的场景（关闭音效时也记住）
let bgmResumeArmed = false;

function bgmPluck(t, freq, dur, gain) {
  const c = bgmCtx;
  if (!c) return;
  const osc = c.createOscillator();
  const harm = c.createOscillator();
  const harmGain = c.createGain();
  const filter = c.createBiquadFilter();
  const env = c.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  harm.type = 'sine';
  harm.frequency.value = freq * 2.004; // 轻微失谐，模拟弦的泛音
  harmGain.gain.value = 0.22;
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.min(6000, freq * 8), t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(420, freq * 1.8), t + dur * 0.85);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(filter);
  harm.connect(harmGain).connect(filter);
  filter.connect(env).connect(bgmMaster);
  osc.start(t);
  harm.start(t);
  osc.stop(t + dur + 0.05);
  harm.stop(t + dur + 0.05);
}

function bgmDrum(t, gain) {
  const c = bgmCtx;
  if (!c) return;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.2);
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  osc.connect(env).connect(bgmMaster);
  osc.start(t);
  osc.stop(t + 0.36);
}

function bgmClap(t, gain) {
  const c = bgmCtx;
  if (!c) return;
  const dur = 0.09;
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2600;
  filter.Q.value = 1.4;
  const env = c.createGain();
  env.gain.value = gain;
  src.connect(filter).connect(env).connect(bgmMaster);
  src.start(t);
}

function bgmSchedule() {
  const c = bgmCtx;
  const preset = BGM_PRESET[bgmMood];
  if (!c || !preset) return;
  const now = c.currentTime;
  if (bgmNext < now) bgmNext = now + 0.05;
  while (bgmNext < now + BGM_LOOKAHEAD) {
    const idx = bgmStep % preset.melody.length;
    const deg = preset.melody[idx];
    if (deg !== null && deg !== undefined) {
      // 力度微随机，避免机械感
      bgmPluck(bgmNext, PENTA[deg], preset.pluckDur, preset.pluckGain * (0.78 + Math.random() * 0.34));
    }
    if (preset.bassEvery && bgmStep % preset.bassEvery === 0) {
      bgmPluck(bgmNext, PENTA[0] / 2, preset.pluckDur * 2.2, preset.bassGain);
    }
    if (preset.drum && BGM_DRUM[bgmStep % BGM_DRUM.length]) bgmDrum(bgmNext, preset.drumGain);
    if (preset.clap && BGM_CLAP[bgmStep % BGM_CLAP.length]) bgmClap(bgmNext, preset.clapGain);
    bgmNext += preset.stepDur;
    bgmStep += 1;
  }
}

// 浏览器自动播放策略：AudioContext 需在用户手势后 resume
function bgmArmResume() {
  const c = bgmCtx;
  if (!c || c.state !== 'suspended' || bgmResumeArmed) return;
  bgmResumeArmed = true;
  const resume = () => {
    if (c.state === 'suspended') c.resume();
    bgmNext = c.currentTime + 0.1;
    document.removeEventListener('pointerdown', resume);
    document.removeEventListener('keydown', resume);
    document.removeEventListener('touchstart', resume);
    bgmResumeArmed = false;
  };
  document.addEventListener('pointerdown', resume);
  document.addEventListener('keydown', resume);
  document.addEventListener('touchstart', resume);
}

function loopTick() {
  bgmSchedule();
}

function startBgm(mood) {
  stopBgm();
  bgmMood = mood || null;
  if (!bgmMood || !BGM_PRESET[bgmMood]) { bgmMood = null; return; }
  const c = ac();
  if (!c) { bgmMood = null; return; }
  bgmCtx = c;
  if (!bgmMaster) {
    bgmMaster = c.createGain();
    bgmMaster.gain.value = 0;
    // 低通柔化，避免高频刺耳；整体压到背景音量
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    bgmMaster.connect(lp).connect(c.destination);
  }
  const g = bgmMaster.gain;
  g.cancelScheduledValues(c.currentTime);
  g.setValueAtTime(g.value, c.currentTime);
  g.linearRampToValueAtTime(BGM_VOLUME, c.currentTime + 1.5);
  bgmStep = 0;
  bgmNext = c.currentTime + 0.12;
  bgmTimer = setInterval(loopTick, BGM_TICK);
  bgmSchedule();
  bgmArmResume();
}

function stopBgm() {
  bgmMood = null;
  if (bgmTimer) {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
  const c = bgmCtx;
  if (!c || !bgmMaster) return;
  const g = bgmMaster.gain;
  g.cancelScheduledValues(c.currentTime);
  g.setValueAtTime(g.value, c.currentTime);
  g.linearRampToValueAtTime(0, c.currentTime + 0.5);
}

/** 切换背景音乐场景；传 null 表示静音 */
export function setBgmMood(mood) {
  const next = mood && BGM_PRESET[mood] ? mood : null;
  bgmWant = next;
  if (!enabled) return;          // 音效关闭时只记下期望场景
  if (bgmMood === next && bgmTimer) return;
  startBgm(next);
}

export function isBgmPlaying() {
  return !!bgmTimer;
}

export function getBgmMood() {
  return bgmWant;
}

// 切到后台时暂停，回前台恢复（省电、避免后台出声）
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
    } else if (enabled && bgmWant && !bgmTimer) {
      startBgm(bgmWant);
    }
  });
}
