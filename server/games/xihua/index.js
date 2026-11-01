import * as engine from './engine.js';
import { MODE_A, MODE_B, deckSize } from './cards.js';

/**
 * 纸牌西游记
 * A 方案：54 张经典版（仙界 / 妖界 / 过牌）
 * B 方案：36 张精简版（循环克制 + 惩罚区 + 白龙马）
 */
const module = {
  id: 'xihua',
  name: '纸牌西游记',
  tagline: '扑克牌 · 出牌罚杯',
  description:
    '以《西游记》人物为牌力的扑克玩法。管不住就要喝，惩罚区里的牌最后一起算账。',
  minPlayers: 2,
  maxPlayers: 10,
  accent: '#8a5cf6',
  revealHandsAtEnd: false,

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
      key: 'mode',
      type: 'enum',
      label: '牌组版本',
      default: MODE_A,
      options: [
        { value: MODE_A, label: '54 张 · 经典版', desc: '仙界 vs 妖界，2 为过牌，管不住罚 1 杯' },
        { value: MODE_B, label: '36 张 · 精简版', desc: '徒弟打妖、妖吃唐僧、唐僧管徒弟，收牌进惩罚区' },
      ],
    },
    {
      key: 'penalty',
      type: 'enum',
      label: '罚杯换算',
      default: 'two',
      showWhen: { key: 'mode', equals: MODE_B },
      options: [
        { value: 'two', label: '2 张牌 1 杯', desc: '惩罚区偶数张 ÷2，奇数张 (n-1)÷2' },
        { value: 'one', label: '1 张牌 1 杯', desc: '惩罚区每张 1 杯' },
      ],
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
    return { playerCount: 4, mode: MODE_A, penalty: 'two', botFill: true };
  },

  normalizeConfig(raw) {
    const base = this.defaultConfig();
    const cfg = { ...base, ...(raw || {}) };
    const count = Number(cfg.playerCount);
    cfg.playerCount = Number.isFinite(count)
      ? Math.min(this.maxPlayers, Math.max(this.minPlayers, Math.round(count)))
      : base.playerCount;
    cfg.mode = cfg.mode === MODE_B ? MODE_B : MODE_A;
    cfg.penalty = cfg.penalty === 'one' ? 'one' : 'two';
    cfg.botFill = cfg.botFill !== false;
    return cfg;
  },

  describeConfig(cfg) {
    const parts = [`${cfg.playerCount} 人`];
    parts.push(cfg.mode === MODE_B ? '36 张 · 精简版' : '54 张 · 经典版');
    if (cfg.mode === MODE_B) parts.push(cfg.penalty === 'one' ? '1 张 1 杯' : '2 张 1 杯');
    if (cfg.botFill) parts.push('可加机器人');
    return parts;
  },

  rulesSummary(cfg) {
    const base = [
      {
        title: '牌力',
        body: cfg.mode === MODE_B
          ? '大妖K > 中妖Q > 小妖J > 唐僧10 > 悟空5 > 八戒8 > 沙僧3'
          : '仙界：大王(如来) > 小王(菩萨) > 10(唐僧) > 5(悟空) > 8(八戒) > 3(沙僧) > 6(白龙马)',
      },
    ];

    if (cfg.mode === MODE_B) {
      base.push(
        { title: '循环克制', body: '妖吃唐僧、唐僧管徒弟、徒弟打妖怪' },
        { title: '特殊牌', body: '2 = 过牌（不罚）；6 = 白龙马，打出后由上家出牌' },
        { title: '出牌', body: '每次出 1~2 张同点牌，下家须同张数且管得住' },
        { title: '惩罚区', body: '管不住就把桌面上那手牌全部收入自己的惩罚区，由下家重新出牌' },
        {
          title: '罚杯',
          body: cfg.penalty === 'one'
            ? '惩罚区每张算 1 杯'
            : '惩罚区偶数张 ÷2，奇数张 (n-1)÷2',
        },
        { title: '结束', body: '出完牌的玩家上岸并获得下局优先出牌权；只剩最后一人时结束，其手牌并入惩罚区' },
      );
      return base;
    }

    base.push(
      { title: '妖界', body: 'A > K > Q > J > 9 > 7 > 4' },
      { title: '克制', body: '所有妖精都能管唐僧；除唐僧外，所有仙界都能管妖精' },
      { title: '特殊牌', body: '2 = 过牌，打出即视为这一轮管不住，但不罚酒' },
      { title: '出牌', body: '每次可出 1~4 张同点牌，下家须同张数且管得住' },
      { title: '罚酒', body: '管不住罚 1 杯，进入罚酒页面点「喝完了」才继续' },
      { title: '结束', body: '出完牌的玩家上岸；只剩最后一人时结束，其剩余手牌每张罚 1 杯' },
    );
    return base;
  },

  /** 按配置区分的规则说明，供创建房间时随选项切换 */
  rulesVariants() {
    const withPenalty = (penalty) =>
      this.rulesSummary(this.normalizeConfig({ mode: MODE_B, penalty }));
    return [
      { match: { mode: MODE_B, penalty: 'one' }, rules: withPenalty('one') },
      { match: { mode: MODE_B }, rules: withPenalty('two') },
      { match: { mode: MODE_A }, rules: this.rulesSummary(this.normalizeConfig({ mode: MODE_A })) },
    ];
  },

  createState({ playerCount, config }) {
    const cfg = this.normalizeConfig(config);
    const state = engine.createState({ playerCount, config: cfg });
    engine.startRound(state, []);
    return state;
  },

  applyAction(state, players, seat, type, payload) {
    return engine.applyAction(state, players, seat, type, payload);
  },

  waitingSeats: engine.waitingSeats,
  hintsFor: engine.hintsFor,
  pendingBotActions: engine.pendingBotActions,
  serialize: engine.serialize,

  PHASE: engine.PHASE,
  deckSize,
};

export default module;
