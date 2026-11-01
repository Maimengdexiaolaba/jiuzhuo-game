import * as engine from './engine.js';
import { DECK_SIZE, diceToSeat } from './cards.js';
import { TIER, ERBA_MAX_TIER, evaluateHand } from './rules.js';

/**
 * 推饼子游戏模块
 * 所有游戏模块遵循同一接口，便于后续扩展扑克等玩法。
 */
const module = {
  id: 'tuibingzi',
  name: '推饼子',
  tagline: '麻将酒局 · 40 张牌',
  description:
    '1~9 筒各 4 张 + 幺鸡 4 张，共 40 张。每人两张牌比大小：一对幺鸡 > 对子 > 点数，0 点（鳖十）最小。',
  minPlayers: 2,
  maxPlayers: 10,
  accent: '#c9a227',

  configSchema: [
    {
      key: 'playerCount',
      type: 'number',
      label: '游戏人数',
      min: 2,
      max: 10,
      default: 4,
      hint: '房间座位数，含机器人',
    },
    {
      key: 'erbaMax',
      type: 'boolean',
      label: '二八最大玩法',
      default: false,
      hint: '开启后，二筒 + 八筒（二八杠）为全场最大牌型；关闭时仅为普通 0 点',
    },
    {
      key: 'botFill',
      type: 'boolean',
      label: '机器人补位',
      default: true,
      hint: '允许房主一键用 AI 机器人填满空位',
    },
  ],

  defaultConfig() {
    return { playerCount: 4, erbaMax: false, botFill: true };
  },

  normalizeConfig(raw) {
    const base = this.defaultConfig();
    const cfg = { ...base, ...(raw || {}) };
    const count = Number(cfg.playerCount);
    cfg.playerCount = Number.isFinite(count)
      ? Math.min(this.maxPlayers, Math.max(this.minPlayers, Math.round(count)))
      : base.playerCount;
    cfg.erbaMax = !!cfg.erbaMax;
    cfg.botFill = cfg.botFill !== false;
    return cfg;
  },

  describeConfig(cfg) {
    const parts = [`${cfg.playerCount} 人`];
    parts.push(cfg.erbaMax ? '二八最大 · 开' : '二八最大 · 关');
    if (cfg.botFill) parts.push('可加机器人');
    return parts;
  },

  rulesSummary(cfg) {
    return [
      { title: '牌组', body: `1~9 筒各 4 张 + 幺鸡 4 张，共 ${DECK_SIZE} 张` },
      {
        title: '牌型大小',
        body: cfg.erbaMax
          ? '二八杠（二筒+八筒） > 一对幺鸡 > 对子 > 点数；0 点（鳖十）最小'
          : '一对幺鸡 > 对子 > 点数；0 点（鳖十）最小，二筒+八筒仅为普通 0 点',
      },
      { title: '点数', body: '两张牌点数相加，取个位数；幺鸡按 1 点计算' },
      { title: '平局', body: '牌型与点数完全相同，庄家大于闲家（闲家输）' },
      { title: '对子翻倍', body: '闲家手牌为对子（含一对幺鸡）时，该笔胜负杯数翻倍' },
      { title: '押酒', body: '庄家不押酒，闲家每局可选 1 / 2 / 3 杯' },
    ];
  },

  createState({ playerCount, config }) {
    return engine.createState({ playerCount, config });
  },

  applyAction(state, players, seat, type, payload) {
    return engine.applyAction(state, players, seat, type, payload);
  },

  waitingSeats: engine.waitingSeats,
  pendingBotActions: engine.pendingBotActions,
  serialize: engine.serialize,

  /** 给前端展示用的手牌牌型摘要（点数 / 对子 / 幺鸡对 / 二八杠） */
  evalHand(hand, config) {
    if (!Array.isArray(hand) || hand.length !== 2) return null;
    const h = evaluateHand(hand, config || {});
    return {
      key: h.key,
      name: h.name,
      point: h.point,
      isPair: h.isPair,
      showPoints: h.showPoints !== false,
      tier: h.tier,
      detail: h.detail,
    };
  },

  cutIndexFromDice: engine.cutIndexFromDice,
  diceToSeat,
  PHASE: engine.PHASE,
  BET_OPTIONS: engine.BET_OPTIONS,
  TIER,
  ERBA_MAX_TIER,
};

export default module;
