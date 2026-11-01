const toastStack = () => document.getElementById('toast-stack');
const modalRoot = () => document.getElementById('modal-root');
const fxRoot = () => document.getElementById('fx-root');

export function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function initials(name) {
  const s = String(name || '?').trim();
  if (!s) return '?';
  if (/[\u4e00-\u9fa5]/.test(s)) return s.slice(0, 1);
  return s.slice(0, 2).toUpperCase();
}

export function toast(message, type = 'info', duration = 2600) {
  const stack = toastStack();
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s, transform .2s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

export function closeAllModals() {
  const root = modalRoot();
  if (root) root.innerHTML = '';
}

/**
 * 打开弹窗
 * @returns {{close: Function, el: HTMLElement}}
 */
export function openModal({ title, subtitle = '', body = '', footer = '', size = '', onClose = null, dismissible = true }) {
  const root = modalRoot();
  root.innerHTML = '';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div>
          <h3>${escapeHTML(title)}</h3>
          ${subtitle ? `<p class="sub">${subtitle}</p>` : ''}
        </div>
        ${dismissible ? '<button class="icon-btn" data-close aria-label="关闭">×</button>' : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.appendChild(backdrop);

  const close = () => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    if (onClose) onClose();
  };

  backdrop.addEventListener('click', (e) => {
    if (!dismissible) return;
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });

  return { close, el: backdrop.querySelector('.modal') };
}

export function confirmDialog({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const { close, el } = openModal({
      title,
      body: `<p style="font-size:13.5px;color:var(--text-dim);line-height:1.7">${message}</p>`,
      footer: `
        <button class="btn btn-ghost" data-act="cancel">${escapeHTML(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escapeHTML(confirmText)}</button>`,
    });
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      close();
      resolve(act === 'ok');
    });
  });
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n) => String(n).padStart(2, '0');
  if (sameDay) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------------- 骰子 ---------------- */

const DIE_FACE = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

export function dieHTML(value = 1) {
  const dots = new Set((DIE_FACE[value] || []).map(([x, y]) => `${x},${y}`));
  let cells = '';
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      cells += `<span class="pip-dot" style="visibility:${dots.has(`${x},${y}`) ? 'visible' : 'hidden'}"></span>`;
    }
  }
  return `<div class="die" data-value="${value}">${cells}</div>`;
}

export { fxRoot };
