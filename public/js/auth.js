import { toast, escapeHTML } from './ui.js';

export function mountAuth(App) {
  const tabs = document.getElementById('auth-tabs');
  const forms = {
    login: document.getElementById('form-login'),
    register: document.getElementById('form-register'),
    guest: document.getElementById('form-guest'),
  };

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    const tab = btn.dataset.tab;
    tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === btn));
    Object.entries(forms).forEach(([k, f]) => { f.hidden = k !== tab; });
  });

  forms.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(forms.login);
    const submit = forms.login.querySelector('button[type="submit"]');
    submit.disabled = true;
    const res = await App.call('auth:login', {
      username: fd.get('username'),
      password: fd.get('password'),
    });
    submit.disabled = false;
    if (res.error) toast(res.error, 'error');
  });

  forms.register.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(forms.register);
    const submit = forms.register.querySelector('button[type="submit"]');
    submit.disabled = true;
    const res = await App.call('auth:register', {
      username: fd.get('username'),
      displayName: fd.get('displayName'),
      password: fd.get('password'),
    });
    submit.disabled = false;
    if (res.error) toast(res.error, 'error');
    else toast('注册成功，欢迎加入', 'ok');
  });

  forms.guest.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(forms.guest);
    const submit = forms.guest.querySelector('button[type="submit"]');
    submit.disabled = true;
    const res = await App.call('auth:guest', { name: fd.get('name') });
    submit.disabled = false;
    if (res.error) toast(res.error, 'error');
  });

  // 每次回到登录页时复位到「登录」标签页
  App.renderers.auth = () => {
    tabs.querySelector('[data-tab="login"]')?.click();
    forms.login.querySelector('input[name="username"]')?.focus?.();
  };
}
