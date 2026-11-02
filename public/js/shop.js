import { openModal, toast, confirmDialog, escapeHTML } from './ui.js';

const CATEGORY_LABEL = {
  cardFace: '牌面',
  theme: '主题',
  bgm: '音乐',
  sfx: '音效',
  misc: '道具',
};

const TYPE_LABEL = {
  consumable: '一次性',
  permanent: '永久',
  timed: '限时',
};

export async function openShopModal(App) {
  const res = await App.call('shop:list', {});
  if (res.error) {
    toast(res.error, 'error');
    return;
  }
  if (res.guest) {
    toast('游客无法使用商城，请注册登录', 'error');
    return;
  }

  const points = res.points ?? 0;
  const items = res.items || [];

  const body = `
    <div class="shop-head">
      <div class="shop-points">我的积分 <b>${points}</b></div>
      <div class="shop-hint">兑换后进入背包，在「设置 → 我的背包」中装备 / 使用</div>
    </div>
    <div class="shop-list">
      ${items.length ? items.map((it) => `
        <div class="shop-item ${it.owned ? 'is-owned' : ''}">
          <div class="shop-item-icon">${
            it.category === 'cardFace' ? '🎴'
              : it.category === 'theme' ? '🎨'
                : it.category === 'bgm' ? '🎵'
                  : it.category === 'sfx' ? '🔔' : '🎁'
          }</div>
          <div class="shop-item-body">
            <div class="shop-item-name">
              ${escapeHTML(it.name)}
              <span class="shop-tag">${escapeHTML(CATEGORY_LABEL[it.category] || '道具')}</span>
              <span class="shop-tag sub">${escapeHTML(TYPE_LABEL[it.type] || '')}</span>
            </div>
            <div class="shop-item-desc">${escapeHTML(it.desc)}</div>
          </div>
          <div class="shop-item-side">
            <div class="shop-item-price">${it.price} 积分</div>
            <button class="btn ${it.owned ? 'btn-ghost' : 'btn-primary'} btn-sm"
                    data-act="shopBuy" data-item="${it.id}" data-price="${it.price}"
                    ${it.owned || points < it.price ? 'disabled' : ''}>
              ${it.owned ? '已拥有' : '兑换'}
            </button>
          </div>
        </div>`).join('')
        : '<div class="shop-empty">商城暂无在售商品</div>'}
    </div>
    <div class="rule-line" style="color:var(--muted);font-size:12px"><span>后续将上架：背景音乐包、特色音效包、主题皮肤、特色牌面等。</span></div>`;

  const { el, close } = openModal({
    title: '积分商城',
    subtitle: `当前积分 ${points}`,
    body,
    size: 'modal-wide',
    footer: '<button class="btn btn-ghost" data-close>关闭</button>',
  });

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="shopBuy"]');
    if (!btn || btn.disabled) return;
    const itemId = btn.dataset.item;
    const price = Number(btn.dataset.price);
    const item = items.find((i) => i.id === itemId);
    const ok = await confirmDialog({
      title: '确认兑换',
      message: `确定花费 ${price} 积分兑换「${item?.name || itemId}」吗？\n兑换后可在「设置 → 我的背包」中使用。`,
      confirmText: '兑换',
    });
    if (!ok) return;
    btn.disabled = true;
    const r = await App.call('shop:buy', { itemId });
    btn.disabled = false;
    if (r.error) {
      toast(r.error, 'error');
      return;
    }
    toast(`兑换成功！「${item?.name || ''}」已放入背包，剩余 ${r.points} 积分`, 'ok');
    if (App.state.user) App.state.user.points = r.points;
    close();
    openShopModal(App);
  });
}
