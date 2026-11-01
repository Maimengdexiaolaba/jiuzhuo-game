/**
 * 百场战绩窗口测试：验证每款游戏只保留最近 100 场。
 * 使用独立的临时数据目录，不影响正式数据。
 */
import fs from 'node:fs';
import path from 'node:path';

const tmp = path.resolve('./.tmp-stats-test');
fs.rmSync(tmp, { recursive: true, force: true });
process.env.DATA_DIR = tmp;

const dbmod = await import('../server/db.js');
const { Users, Matches } = dbmod;

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\n百场战绩窗口测试\n' + '─'.repeat(46));

const user = Users.create({ username: 'stat_tester', password: '123456', displayName: '测试员' });

// 写入 130 场：前 65 场胜、后 65 场负，便于验证窗口截断方向
for (let i = 0; i < 130; i += 1) {
  const win = i < 65;
  Matches.record(user.id, 'tuibingzi', {
    outcome: win ? 'win' : 'lose',
    net: win ? 2 : -1,
    cupsWon: win ? 2 : 0,
    cupsLost: win ? 0 : 1,
  });
}

let stats = Matches.statsFor(user.id);
check('只返回一条游戏记录', stats.length === 1, JSON.stringify(stats));
check('场次被截断为 100', stats[0].played === 100, `played=${stats[0]?.played}`);
check('WINDOW 标记为 100', stats[0].window === 100);

// 130 场里最新 100 场 = 第 31~130 场（35 胜 + 65 负）
check('胜场只统计窗口内（35）', stats[0].wins === 35, `wins=${stats[0].wins}`);
check('负场只统计窗口内（65）', stats[0].losses === 65, `losses=${stats[0].losses}`);
check('胜率 = 35%', stats[0].winRate === 35, `winRate=${stats[0].winRate}`);
check('净杯 = 35*2 - 65*1 = 5', stats[0].net === 5, `net=${stats[0].net}`);

const recent = Matches.recent(user.id, 'tuibingzi', 20);
check('最近 20 场可取', recent.length === 20);
check('最近 20 场全部为负', recent.every((r) => r.outcome === 'lose'));

// 另一款游戏互不影响
for (let i = 0; i < 5; i += 1) {
  Matches.record(user.id, 'xihua', { outcome: 'win', net: 1, cupsWon: 1, cupsLost: 0 });
}
stats = Matches.statsFor(user.id);
check('两款游戏分别统计', stats.length === 2, JSON.stringify(stats.map((s) => s.gameId)));
const xh = stats.find((s) => s.gameId === 'xihua');
check('新游戏独立窗口', xh.played === 5 && xh.wins === 5);

// 删除用户应连带清理战绩
Users.remove(user.id);
check('删除用户后战绩清空', Matches.total() === 0, `total=${Matches.total()}`);

console.log('─'.repeat(46));
console.log(`通过 ${passed} / ${passed + failed}${failed ? ` · 失败 ${failed}` : ''}\n`);

try {
  dbmod.default.close();
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (err) {
  console.log(`（临时目录未能自动删除，可手动清理：${tmp}）`);
}
process.exit(failed ? 1 : 0);
