import { openModal, toast, escapeHTML } from './ui.js';

const OUTCOME_TEXT = { win: '胜', lose: '负', draw: '平' };

function recentDots(recent) {
  if (!recent || !recent.length) return '';
  const list = recent.slice().reverse(); // 旧 -> 新
  return list
    .map(
      (r) =>
        `<span class="stat-dot ${r.outcome}" title="${OUTCOME_TEXT[r.outcome] || ''} ${r.net > 0 ? '+' : ''}${r.net} 杯"></span>`
    )
    .join('');
}

function gameCard(stat) {
  const played = stat.played || 0;
  const rate = stat.winRate || 0;
  const net = stat.net || 0;
  return `
    <div class="stat-card">
      <div class="stat-head">
        <span class="stat-game">${escapeHTML(stat.gameName || stat.gameId)}</span>
        <span class="stat-window">近 ${stat.window || 100} 场 · 已记录 ${played} 场</span>
      </div>
      <div class="stat-main">
        <div class="stat-rate">
          <b>${played ? rate.toFixed(1) : '—'}</b>${played ? '<small>%</small>' : ''}
          <span>胜率</span>
        </div>
        <div class="stat-nums">
          <span class="win">胜 <b>${stat.wins || 0}</b></span>
          <span class="lose">负 <b>${stat.losses || 0}</b></span>
          <span class="draw">平 <b>${stat.draws || 0}</b></span>
          <span class="net ${net > 0 ? 'plus' : net < 0 ? 'minus' : ''}">
            净 ${net > 0 ? '+' : ''}${net} 杯
          </span>
        </div>
      </div>
      <div class="stat-bar"><i style="width:${Math.min(100, rate)}%"></i></div>
      ${stat.recent && stat.recent.length
        ? `<div class="stat-recent"><span>最近</span><div class="stat-dots">${recentDots(stat.recent)}</div></div>`
        : ''}
    </div>`;
}

export async function openStatsModal(App) {
  const res = await App.call('me:stats', {});
  if (res.error) {
    toast(res.error, 'error');
    return;
  }

  const stats = (res.stats || []).filter((s) => s.played > 0);
  const body = stats.length
    ? `
      <div class="stat-list">${stats.map(gameCard).join('')}</div>
      <div class="rules-box">
        <span class="rb-title">统 计 口 径</span>
        <div class="rule-line"><span>每局结束记录一次：该局净胜杯数 &gt; 0 记为胜，&lt; 0 记为负，= 0 记为平。</span></div>
        <div class="rule-line" style="color:var(--muted)"><span>每位玩家每款游戏只保留最近 100 场，更早的记录会自动清除。</span></div>
      </div>`
    : `
      <div class="empty-state" style="margin:0;padding:44px 20px">
        <p>还没有战绩</p>
        <span>开一桌打完一局，这里就会记下来</span>
      </div>`;

  openModal({
    title: '我的战绩',
    subtitle: `${escapeHTML(App.state.user?.displayName || '')} · 百场胜率`,
    body,
    size: 'modal-wide',
    footer: '<button class="btn btn-ghost" data-close>关闭</button>',
  });
}
