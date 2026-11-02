import { openModal, toast, confirmDialog, escapeHTML } from './ui.js';

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
      <div class="shop-hint">积分可用于兑换虚拟物品</div>
    </div>
    <div class="shop-list">
      ${items.map((it) => `
        <div class="shop-item">
          <div class="shop-item-icon">🎴</div>
          <div class="shop-item-body">
            <div class="shop-item-name">${escapeHTML(it.name)}</div>
            <div class="shop-item-desc">${escapeHTML(it.desc)}</div>
          </div>
          <div class="shop-item-side">
            <div class="shop-item-price">${it.price} 积分</div>
            <button class="btn btn-primary btn-sm" data-act="shopBuy" data-item="${it.id}" data-price="${it.price}" ${points < it.price ? 'disabled' : ''}>
              兑换
            </button>
          </div>
        </div>`).join('')}
    </div>
    <div class="rule-line" style="color:var(--muted);font-size:12px"><span>新商品陆续上架中：牌背、背景主题、桌面皮肤、金色手牌等。</span></div>`;

  const { el, close } = openModal({
    title: '积分商城',
    subtitle: `当前积分 ${points}`,
    body,
    size: 'modal-wide',
    footer: '<button class="btn btn-ghost" data-close>关闭</button>',
  });

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act="shopBuy"]');
    if (!btn) return;
    const itemId = btn.dataset.item;
    const price = Number(btn.dataset.price);
    const item = items.find((i) => i.id === itemId);
    const ok = await confirmDialog({
      title: '确认兑换',
      message: `确定花费 ${price} 积分兑换「${item?.name || itemId}」吗？`,
      confirmText: '兑换',
    });
    if (!ok) return;
    const r = await App.call('shop:buy', { itemId });
    if (r.error) {
      toast(r.error, 'error');
      return;
    }
    toast(`兑换成功！${item?.name || ''} 已生效，剩余 ${r.points} 积分`, 'info');
    close();
    openShopModal(App);
  });
}
