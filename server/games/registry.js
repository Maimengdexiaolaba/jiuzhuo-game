import tuibingzi from './tuibingzi/index.js';
import xihua from './xihua/index.js';
import supermeng from './supermeng/index.js';

/**
 * 游戏注册表
 * 新增玩法只需在 games/ 下实现同一接口的模块，然后在此登记。
 */
const modules = new Map();

export function registerGame(mod) {
  modules.set(mod.id, mod);
}

registerGame(tuibingzi);
registerGame(xihua);
registerGame(supermeng);

export function getGame(id) {
  return modules.get(id) || null;
}

/**
 * 排期中的玩法：只在大厅占位展示，没有引擎、不能创建房间（getGame 返回 null）
 * 上架时把它实现成正式模块、注册进来，再从这里移除
 */
const PLANNED_GAMES = [
  {
    id: 'dice_bluff',
    name: '骰子吹牛',
    tagline: '摇骰叫点 · 猜心吹牛',
    description: '每人五颗骰子扣盅摇点，按顺序叫「点数 + 个数」，下家可加叫或开盅验证，酒桌上最经典的心理战。',
    minPlayers: 2,
    maxPlayers: 6,
    accent: '#c9a227',
    enabled: false,
    planned: true,
    configSchema: [],
    defaultConfig: {},
    rules: [
      { title: '玩法', body: '每人 5 颗骰子摇盅后扣住，顺时针叫「点数 + 个数」，下家只能往更高叫或选择开盅' },
      { title: '开盅', body: '叫数成立则被开者喝，不成立则开盅者喝；1 点可作万能点（可关闭）' },
      { title: '状态', body: '排期开发中，敬请期待' },
    ],
    rulesVariants: [],
  },
];

export function listGames() {
  const live = [...modules.values()].map((m) => ({
    id: m.id,
    name: m.name,
    tagline: m.tagline,
    description: m.description,
    minPlayers: m.minPlayers,
    maxPlayers: m.maxPlayers,
    accent: m.accent,
    enabled: true,
    planned: false,
    configSchema: m.configSchema,
    defaultConfig: m.defaultConfig(),
    rules: m.rulesSummary(m.defaultConfig()),
    rulesVariants: m.rulesVariants ? m.rulesVariants() : [],
  }));
  return [...live, ...PLANNED_GAMES];
}

export default { registerGame, getGame, listGames };
