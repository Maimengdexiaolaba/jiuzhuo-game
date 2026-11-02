import { openModal, toast, escapeHTML } from './ui.js';
import { setBgmEnabled, setSfxEnabled, isBgmEnabled, isSfxEnabled } from './audio.js';

/**
 * 皮肤选项定义（前端元数据，真实可购项以商城商品为准）
 * value 与 skins 字段值一致；itemId 对应商城商品（未拥有则显示锁定）
 */
const SKIN_GROUPS = [
  {
    key: 'cardFace',
    label: '牌面',
    desc: '所有游戏使用的扑克牌面 / 牌背',
    options: [
      { value: 'classic', label: '经典牌面', desc: '标准扑克，点数清晰', free: true },
      { value: 'xihua', label: '西游记牌面', desc: '西游记角色插画 + 大号数字', itemId: 'card_face_xihua' },
    ],
  },
  {
    key: 'theme',
    label: '主题皮肤',
    desc: '整体配色与牌桌风格',
    options: [
      { value: 'default', label: '墨绿主题', desc: '经典深绿牌桌 + 金色点缀', free: true },
      { value: 'warm', label: '暖阳主题', desc: '暖橙 / 木质色调，柔和温润', itemId: 'theme_warm' },
    ],
  },
  {
    key: 'bgm',
    label: '背景音乐',
    desc: '大厅与牌局的背景音乐（后续上架更多音乐包）',
    options: [{ value: 'default', label: '默认音乐', desc: '内置五声音阶合成', free: true }],
  },
  {
    key: 'sfx',
    label: '音效',
    desc: '发牌 / 出牌 / 结算音效与语音播报（后续上架特色音效包）',
    options: [{ value: 'default', label: '默认音效', desc: '内置合成音效 + 语音播报', free: true }],
  },
];

const CATEGORY_LABEL = {
  cardFace: '牌面',
  theme: '主题',
  bgm: '音乐',
  sfx: '音效',
  misc: '道具',
};

function skinOptionsHTML(group, skins, owned) {
  return group.options
    .map((opt) => {
      const active = (skins?.[group.key] || '') === opt.value;
      const locked = !opt.free && opt.itemId && !owned.includes(opt.itemId);
      return `
        <button type="button" class="skin-opt ${active ? 'is-on' : ''} ${locked ? 'is-locked' : ''}"
                data-act="skinPick" data-category="${group.key}" data-value="${opt.value}"
                ${locked ? 'data-locked="1"' : ''}>
          <span class="skin-opt-name">${escapeHTML(opt.label)}${active ? ' ✓' : ''}</span>
          <span class="skin-opt-desc">${escapeHTML(locked ? '未拥有 · 商城兑换' : opt.desc)}</span>
        </button>`;
    })
    .join('');
}

function inventoryHTML(items) {
  if (!items.length) {
    return '<div class="inv-empty">背包是空的，去<a href="#" data-act="goShop">积分商城</a>看看</div>';
  }
  return `<div class="inv-list">
    ${items.map((it) => {
      const isSkin = it.type === 'permanent' && it.asset;
      return `
      <div class="inv-item">
        <div class="inv-icon">${it.category === 'cardFace' ? '🎴' : it.category === 'theme' ? '🎨' : '🎁'}</div>
        <div class="inv-body">
          <div class="inv-name">${escapeHTML(it.name)}${it.quantity > 1 ? ` ×${it.quantity}` : ''}</div>
          <div class="inv-desc">${escapeHTML(it.desc || '')}</div>
          <div class="inv-tag">${escapeHTML(CATEGORY_LABEL[it.category] || '道具')}${it.type === 'consumable' ? ' · 一次性' : ' · 永久'}</div>
        </div>
        <div class="inv-side">
          <button class="btn btn-primary btn-sm" data-act="invUse" data-item="${it.id}">
            ${isSkin ? '装 备' : '使 用'}
          </button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

export async function openSettingsModal(App) {
  const res = await App.call('skins:get', {});
  if (res.error) {
    toast(res.error, 'error');
    return;
  }
  let skins = res.skins || {};
  const owned = res.owned || [];

  const invRes = await App.call('inventory:list', {});
  let inventory = invRes.items || [];

  let bgmOn = isBgmEnabled();
  let sfxOn = isSfxEnabled();

  const bodyHTML = () => `
    <div class="settings-wrap">
      <div class="settings-section">
        <div class="settings-title">音频</div>
        <div class="settings-switch-row">
          <div>
            <div class="sw-label">背景音乐</div>
            <div class="sw-desc">大厅与牌局的背景音乐</div>
          </div>
          <label class="switch"><input type="checkbox" data-act="toggleBgm" ${bgmOn ? 'checked' : ''} /><span class="track"></span></label>
        </div>
        <div class="settings-switch-row">
          <div>
            <div class="sw-label">音效 / 语音</div>
            <div class="sw-desc">发牌、出牌、结算音效与语音播报</div>
          </div>
          <label class="switch"><input type="checkbox" data-act="toggleSfx" ${sfxOn ? 'checked' : ''} /><span class="track"></span></label>
        </div>
      </div>

      ${SKIN_GROUPS.map((g) => `
        <div class="settings-section">
          <div class="settings-title">${escapeHTML(g.label)}</div>
          <div class="settings-sub">${escapeHTML(g.desc)}</div>
          <div class="skin-grid">${skinOptionsHTML(g, skins, owned)}</div>
        </div>`).join('')}

      <div class="settings-section">
        <div class="settings-title">我的背包</div>
        <div class="settings-sub">兑换的道具在这里使用 / 装备</div>
        ${inventoryHTML(inventory)}
      </div>
    </div>`;

  const { el, close } = openModal({
    title: '设置',
    subtitle: '牌面 / 主题 / 音频 / 背包',
    body: bodyHTML(),
    size: 'modal-wide',
    footer: '<button class="btn btn-ghost" data-close>关闭</button>',
  });

  const repaint = () => {
    const scroll = el.querySelector('.modal-body')?.scrollTop || 0;
    const body = el.querySelector('.modal-body');
    if (body) {
      body.innerHTML = bodyHTML();
      body.scrollTop = scroll;
    }
  };

  el.addEventListener('change', async (e) => {
    const act = e.target.dataset?.act;
    if (act === 'toggleBgm') {
      bgmOn = e.target.checked;
      setBgmEnabled(bgmOn);
      App.persistAudioFlags?.();
      return;
    }
    if (act === 'toggleSfx') {
      sfxOn = e.target.checked;
      setSfxEnabled(sfxOn);
      App.persistAudioFlags?.();
    }
  });

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'goShop') {
      e.preventDefault();
      close();
      App.openShop?.();
      return;
    }

    if (act === 'skinPick') {
      if (btn.dataset.locked) {
        toast('该皮肤尚未拥有，请先到积分商城兑换', 'warn');
        return;
      }
      const category = btn.dataset.category;
      const value = btn.dataset.value;
      const r = await App.call('skins:set', { category, value });
      if (r.error) {
        toast(r.error, 'error');
        return;
      }
      skins = r.skins || skins;
      App.applySkins(skins);
      repaint();
      toast('已切换', 'ok');
      return;
    }

    if (act === 'invUse') {
      const itemId = btn.dataset.item;
      btn.disabled = true;
      const r = await App.call('inventory:use', { itemId });
      btn.disabled = false;
      if (r.error) {
        toast(r.error, 'error');
        return;
      }
      toast(r.message || '已使用', 'ok');
      skins = r.skins || skins;
      inventory = r.inventory || inventory;
      App.applySkins(skins);
      repaint();
    }
  });
}
