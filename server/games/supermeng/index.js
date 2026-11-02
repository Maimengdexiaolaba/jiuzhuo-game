import * as engine from './engine.js';
import { evaluateHand, compareHands } from './rules.js';

/**
 * 超级梦幻（梦幻扎金花 · 两张暗牌版）
 * 每人 2 张暗牌，无公牌，想象第 3 张组成最大牌型；闲家叫酒、庄家开牌结算。
 */
const module = {
  id: 'supermeng',
  name: '超级梦幻',
  tagline: '两张暗牌 · 想象第三张',
  description:
    '两张牌加上想象的一张凑出最大牌型，闲家押酒、庄家开牌。炸、同花顺、顺子、金花，心理战拉满。',
  minPlayers: 2,
  maxPlayers: 12,
  accent: '#d4608a',
  revealHandsAtEnd: true,

  configSchema: [
    {
      key: 'playerCount',
      type: 'number',
      label: '游戏人数',
      min: 2,
      max: 12,
      default: 4,
      hint: '房间座位数，含机器人',
    },
    {
      key: 'withJoker',
      type: 'boolean',
      label: '大小王',
      default: true,
      hint: '开启后大小王可当癞子（组成假炸弹 / 天炸）',
    },
    {
      key: 'orderRule',
      type: 'enum',
      label: '顺子 / 金花 大小',
      default: 'straightFirst',
      options: [
        { value: 'straightFirst', label: '顺子 > 金花', desc: '同花顺 > 顺子 > 金花' },
        { value: 'flushFirst', label: '金花 > 顺子', desc: '同花顺 > 金花 > 顺子' },
      ],
    },
    {
      key: 'bombRule',
      type: 'enum',
      label: '炸弹比法',
      default: 'realFirst',
      showWhen: { key: 'withJoker', equals: true },
      options: [
        { value: 'realFirst', label: '真炸 > 假炸', desc: '真豹子永远大于癞子凑的假豹子' },
        { value: 'byPoint', label: '炸弹比点数', desc: '真假炸弹按点数比，同点庄家胜' },
      ],
    },
    {
      key: 'eatBomb235',
      type: 'boolean',
      label: '235 吃炸弹',
      default: true,
      hint: '手牌 2、5 不同色时 235 可吃真炸与单癞假炸（不吃天炸）',
    },
    {
      key: 'ace23',
      type: 'boolean',
      label: 'A 可当 1',
      default: true,
      hint: '开启后 A、2 与 A、3 可组成 A23 顺子；关闭则只能 QKA',
    },
    {
      key: 'allowBlind',
      type: 'boolean',
      label: '允许闷牌',
      default: false,
      hint: '发牌前可声明不看牌押酒，输赢按闷牌倍率结算',
    },
    {
      key: 'dealerChange',
      type: 'enum',
      label: '庄家换牌',
      default: 'none',
      options: [
        { value: 'none', label: '不换牌', desc: '不换牌模式下庄家每局至少开一家' },
        { value: 'once', label: '换 1 手', desc: '整个庄家任期最多换一次手牌（两张全换，喝 1 杯）' },
        { value: 'twice', label: '换 2 手', desc: '整个庄家任期最多换两次手牌（每次喝 1 杯）' },
      ],
    },
    {
      key: 'betMax',
      type: 'enum',
      label: '叫酒上限',
      default: 3,
      options: [
        { value: 2, label: '最多 2 杯', desc: '可叫 1~2 杯' },
        { value: 3, label: '最多 3 杯', desc: '可叫 1~3 杯' },
        { value: 'g2', label: '干 2', desc: '全场默认 2 杯，不再逐人押酒' },
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
    return {
      playerCount: 4,
      withJoker: true,
      orderRule: 'straightFirst',
      bombRule: 'realFirst',
      eatBomb235: true,
      ace23: true,
      allowBlind: false,
      dealerChange: 'none',
      betMax: 3,
      botFill: true,
    };
  },

  normalizeConfig(raw) {
    const base = this.defaultConfig();
    const cfg = { ...base, ...(raw || {}) };
    const count = Number(cfg.playerCount);
    cfg.playerCount = Number.isFinite(count)
      ? Math.min(this.maxPlayers, Math.max(this.minPlayers, Math.round(count)))
      : base.playerCount;
    cfg.withJoker = cfg.withJoker !== false;
    cfg.orderRule = cfg.orderRule === 'flushFirst' ? 'flushFirst' : 'straightFirst';
    cfg.bombRule = cfg.bombRule === 'byPoint' ? 'byPoint' : 'realFirst';
    cfg.eatBomb235 = cfg.eatBomb235 !== false;
    cfg.ace23 = cfg.ace23 !== false;
    cfg.allowBlind = cfg.allowBlind === true;
    cfg.dealerChange = ['once', 'twice'].includes(cfg.dealerChange) ? cfg.dealerChange : 'none';
    cfg.betMax = [2, 3].includes(Number(cfg.betMax)) ? Number(cfg.betMax) : (cfg.betMax === 'g2' ? 'g2' : 3);
    cfg.botFill = cfg.botFill !== false;
    return cfg;
  },

  describeConfig(cfg) {
    const parts = [`${cfg.playerCount} 人`];
    parts.push(cfg.withJoker ? '含大小王' : '无大小王');
    parts.push(cfg.orderRule === 'flushFirst' ? '金花>顺子' : '顺子>金花');
    if (cfg.eatBomb235) parts.push('235吃炸弹');
    if (cfg.allowBlind) parts.push('可闷牌');
    parts.push(cfg.dealerChange === 'none' ? '庄家不换牌' : `庄家换${cfg.dealerChange === 'once' ? 1 : 2}手`);
    parts.push(cfg.betMax === 'g2' ? '干2（全场2杯）' : `叫酒≤${cfg.betMax}杯`);
    if (cfg.botFill) parts.push('可加机器人');
    return parts;
  },

  rulesSummary(cfg) {
    const c = this.normalizeConfig(cfg);
    const orderText = c.orderRule === 'flushFirst'
      ? '天炸 > 炸弹 > 同花顺 > 金花 > 顺子 > 单牌'
      : '天炸 > 炸弹 > 同花顺 > 顺子 > 金花 > 单牌';
    return [
      { title: '牌型', body: orderText + '（无对子）' },
      { title: '炸弹', body: c.withJoker
        ? '真炸=两张同点；假炸=王+牌；天炸=大王+小王（最高）。' + (c.bombRule === 'realFirst' ? '真炸>假炸' : '按点数比，同点庄家胜')
        : '两张同点即炸弹' },
      { title: '顺子/金花', body: '相邻或隔一张为顺子，同色为金花，同色且相邻/隔一为同花顺' },
      { title: 'A', body: c.ace23 ? 'A 可当 1 组成 A23，也可组成 QKA' : 'A 只能组成 QKA' },
      { title: '235', body: c.eatBomb235 ? '手牌 2、5 不同色可吃炸弹（不吃天炸），否则算单牌' : '235 无特殊，仅按单牌算' },
      { title: '叫酒', body: c.betMax === 'g2'
        ? '干 2：全场默认 2 杯，跳过逐人叫酒'
        : `从庄家下家顺时针叫 1~${c.betMax} 杯；首家叫 2 或 3 杯时尾家可锁全场` },
      { title: '开牌', body: '庄家至少开一家' },
      { title: '换牌', body: c.dealerChange === 'none' ? '庄家不能换牌' : `庄家整个任期最多换${c.dealerChange === 'once' ? '1' : '2'}手，每次两张全换喝 1 杯` },
      { title: '闷牌', body: c.allowBlind ? '发牌前可声明闷牌；不服结算：闲家闷+庄家看牌时庄家输喝 4 倍' : '本局不允许闷牌' },
    ];
  },

  rulesVariants() {
    return [
      { match: { orderRule: 'flushFirst' }, rules: this.rulesSummary({ orderRule: 'flushFirst' }) },
      { match: {}, rules: this.rulesSummary({}) },
    ];
  },

  createState({ playerCount, config }) {
    const cfg = this.normalizeConfig(config);
    return engine.createState({ playerCount, config: cfg });
  },

  applyAction(state, players, seat, type, payload) {
    return engine.applyAction(state, players, seat, type, payload);
  },

  waitingSeats: engine.waitingSeats,
  pendingBotActions: engine.pendingBotActions,
  serialize: engine.serialize,

  /** 两张手牌的牌型摘要，供前端展示 */
  evalHand(hand, config) {
    if (!Array.isArray(hand) || hand.length !== 2) return null;
    const h = evaluateHand(hand[0], hand[1], config || {});
    return {
      key: h.key,
      name: h.name,
      rank: h.rank,
      bombType: h.bombType,
      isBomb: h.key === 'bomb',
      is235: h.key === 'bomb235',
      tier: h.key === 'bomb' ? 6 : h.key === 'flushStraight' ? 5 : (h.key === 'straight' || h.key === 'flush') ? 3 : 1,
    };
  },

  PHASE: engine.PHASE,
  PHASE_TEXT: engine.PHASE_TEXT,
};

export default module;
