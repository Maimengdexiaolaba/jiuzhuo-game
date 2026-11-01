import { toast, openModal, confirmDialog, escapeHTML, fmtTime } from './ui.js';

export function mountAdmin(App) {
  const tbody = document.getElementById('admin-tbody');
  const sub = document.getElementById('admin-sub');

  document.getElementById('btn-admin-back').addEventListener('click', () => App.navigate('lobby'));
  document.getElementById('btn-admin-new').addEventListener('click', () => openEditModal(App, null));

  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const user = App.state.adminUsers.find((u) => u.id === id);
    if (!user) return;

    if (btn.dataset.act === 'edit') {
      openEditModal(App, user);
    } else if (btn.dataset.act === 'toggle') {
      const res = await App.call('admin:update', { id, disabled: !user.disabled });
      if (res.error) return toast(res.error, 'error');
      App.state.adminUsers = res.users;
      render(App);
      toast(user.disabled ? '账号已启用' : '账号已停用', 'ok');
    } else if (btn.dataset.act === 'del') {
      const ok = await confirmDialog({
        title: '删除账号',
        message: `确定删除账号「${escapeHTML(user.username)}」吗？该操作不可撤销，其登录会话将立即失效。`,
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      const res = await App.call('admin:delete', { id });
      if (res.error) return toast(res.error, 'error');
      App.state.adminUsers = res.users;
      render(App);
      toast('账号已删除', 'ok');
    }
  });

  async function load() {
    const res = await App.call('admin:list', {});
    if (res.error) {
      toast(res.error, 'error');
      App.navigate('lobby');
      return;
    }
    App.state.adminUsers = res.users;
    sub.textContent = `共 ${res.users.length} 个账号 · ${res.online} 人在线 · ${res.rooms} 个房间`;
    render(App);
  }

  async function openEditModal(ctx, user) {
    const isNew = !user;
    const body = `
      <label class="field">
        <span>账号</span>
        <input name="username" value="${user ? escapeHTML(user.username) : ''}" placeholder="3~16 位中英文或数字" />
      </label>
      <label class="field">
        <span>昵称</span>
        <input name="displayName" value="${user ? escapeHTML(user.displayName) : ''}" placeholder="牌桌上显示的名字" maxlength="16" />
      </label>
      <label class="field">
        <span>${isNew ? '初始密码' : '重置密码（留空则不修改）'}</span>
        <input name="password" type="text" placeholder="${isNew ? '至少 3 位' : '留空保持原密码'}" />
      </label>
      ${user && user.stats && user.stats.length ? `
      <div class="rules-box">
        <span class="rb-title">百 场 战 绩</span>
        ${user.stats.map((s) => `<div class="rule-line">
          <b>${escapeHTML(s.gameName)}</b>
          <span>${s.played} 场 · 胜 ${s.wins} / 负 ${s.losses} / 平 ${s.draws} · 胜率 ${s.winRate}% · 净 ${s.net > 0 ? '+' : ''}${s.net} 杯</span>
        </div>`).join('')}
      </div>` : ''}
      <div class="config-row" style="margin-top:4px">
        <div>
          <div class="cr-label">管理员权限</div>
          <div class="cr-hint">可进入后台查看并管理所有账号</div>
        </div>
        <label class="switch">
          <input type="checkbox" name="isAdmin" ${user?.isAdmin ? 'checked' : ''} />
          <span class="track"></span>
        </label>
      </div>`;

    const { el, close } = openModal({
      title: isNew ? '新建账号' : '编辑账号',
      subtitle: isNew ? '为家庭成员开一个长期账号' : `ID ${user.id.slice(0, 8)}`,
      body,
      footer: `
        <button class="btn btn-ghost" data-act="cancel">取消</button>
        <button class="btn btn-primary" data-act="save">${isNew ? '创建' : '保存'}</button>`,
    });

    el.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') return close();
      if (act !== 'save') return;

      const payload = {
        username: el.querySelector('[name=username]').value.trim(),
        displayName: el.querySelector('[name=displayName]').value.trim(),
        password: el.querySelector('[name=password]').value,
        isAdmin: el.querySelector('[name=isAdmin]').checked,
      };

      const res = isNew
        ? await App.call('admin:create', payload)
        : await App.call('admin:update', { id: user.id, ...payload, isAdmin: payload.isAdmin });

      if (res.error) return toast(res.error, 'error');

      if (isNew) {
        const list = await App.call('admin:list', {});
        if (list.users) App.state.adminUsers = list.users;
      } else {
        App.state.adminUsers = res.users;
      }
      close();
      render(App);
      toast(isNew ? '账号已创建' : '已保存', 'ok');
    });
  }

  App.renderers.admin = load;
}

function render(App) {
  const tbody = document.getElementById('admin-tbody');
  const users = App.state.adminUsers || [];
  const me = App.state.user;

  tbody.innerHTML = users
    .map((u) => {
      const isSelf = me && u.id === me.id;
      return `
      <tr>
        <td><strong>${escapeHTML(u.username)}</strong>${isSelf ? ' <span class="tag">你</span>' : ''}</td>
        <td>${escapeHTML(u.displayName)}</td>
        <td>${u.isAdmin ? '<span class="tag admin">管理员</span>' : '<span class="tag">成员</span>'}</td>
        <td style="font-size:12px">
          ${(u.stats && u.stats.length)
            ? u.stats.map((s) => `<span class="stat-pill">${escapeHTML(s.gameName)} <b>${s.winRate}%</b> <i>${s.played} 场</i></span>`).join(' ')
            : '<span style="color:var(--muted)">暂无战绩</span>'}
        </td>
        <td style="color:var(--muted);font-size:12px">${fmtTime(u.lastLoginAt)}</td>
        <td>${u.disabled ? '<span class="tag off">已停用</span>' : '<span class="tag on">正常</span>'}</td>
        <td class="col-actions">
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${u.id}">编辑</button>
            <button class="btn btn-ghost btn-sm" data-act="toggle" data-id="${u.id}" ${isSelf ? 'disabled' : ''}>
              ${u.disabled ? '启用' : '停用'}
            </button>
            <button class="btn btn-danger btn-sm" data-act="del" data-id="${u.id}"
              ${isSelf || u.username === 'admin' ? 'disabled' : ''}>删除</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
}
