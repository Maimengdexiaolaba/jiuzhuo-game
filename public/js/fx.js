import { tileHTML } from './tiles.js';
import { sleep } from './ui.js';

const root = () => document.getElementById('fx-root');

let queue = Promise.resolve();

/** 串行播放，避免多个动画叠加 */
function enqueue(fn) {
  queue = queue.then(fn).catch((err) => console.warn('[fx] 动画异常', err));
  return queue;
}

function mount(html) {
  const host = root();
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const el = wrap.firstElementChild;
  host.appendChild(el);
  return el;
}

/* ---------------- 洗牌 ---------------- */

export function playShuffle() {
  return enqueue(async () => {
    const el = mount(`
      <div class="shuffle-overlay">
        <div class="shuffle-stage">
          <div class="shuffle-label">洗 牌 中</div>
        </div>
      </div>`);
    const stage = el.querySelector('.shuffle-stage');
    const label = el.querySelector('.shuffle-label');

    const tiles = [];
    for (let i = 0; i < 40; i += 1) {
      const t = document.createElement('div');
      t.innerHTML = tileHTML(null, { size: 'xs' });
      const node = t.firstElementChild;
      node.style.setProperty('--tw', '15px');
      node.style.transform = `translate(-50%, -50%) rotate(${(Math.random() - 0.5) * 50}deg)`;
      node.style.opacity = '0';
      stage.appendChild(node);
      tiles.push(node);
    }

    await sleep(30);
    tiles.forEach((t) => { t.style.opacity = '1'; });
    await sleep(120);

    // 打乱：随机散开
    tiles.forEach((t) => {
      const dx = (Math.random() - 0.5) * 300;
      const dy = (Math.random() - 0.5) * 190;
      const rot = (Math.random() - 0.5) * 90;
      t.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`;
    });
    await sleep(620);

    // 收拢成上下两叠牌墙
    tiles.forEach((t, i) => {
      const row = i < 20 ? 0 : 1;
      const col = i % 20;
      const x = -152 + col * 16 + 8;
      const y = row === 0 ? -32 : 32;
      t.style.transition = 'transform .55s cubic-bezier(.25,.8,.35,1), opacity .3s';
      t.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(0deg)`;
    });
    label.textContent = '两 叠 牌 墙';

    await sleep(780);
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    await sleep(320);
    el.remove();
  });
}

/* ---------------- 掷骰 ---------------- */

const PIPS = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function dieMarkup(value) {
  const dots = new Set((PIPS[value] || []).map(([x, y]) => `${x},${y}`));
  let cells = '';
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      cells += `<span class="pip-dot" style="visibility:${dots.has(`${x},${y}`) ? 'visible' : 'hidden'}"></span>`;
    }
  }
  return cells;
}

/**
 * 掷骰动画
 * @param {{d1:number,d2:number,total:number,targetName?:string,isDealer?:boolean,purpose?:string}} data
 */
export function playDice(data) {
  return enqueue(async () => {
    const isCut = data.purpose === 'cut';
    const el = mount(`
      <div class="shuffle-overlay">
        <div class="shuffle-stage" style="height:auto;display:flex;flex-direction:column;align-items:center;gap:22px">
          <div class="dice-pair">
            <div class="die rolling">${dieMarkup(1)}</div>
            <div class="die rolling">${dieMarkup(1)}</div>
          </div>
          <div class="die-total" data-total>骰 子 掷 出 中</div>
          <div class="shuffle-label" style="position:static">${isCut ? '定 切 牌 人' : '定 起 手 位'}</div>
        </div>
      </div>`);

    const dice = el.querySelectorAll('.die');
    const totalEl = el.querySelector('[data-total]');

    const spinTimer = setInterval(() => {
      dice.forEach((d) => {
        const v = 1 + Math.floor(Math.random() * 6);
        d.innerHTML = dieMarkup(v);
      });
    }, 90);

    await sleep(1150);
    clearInterval(spinTimer);
    dice.forEach((d, i) => {
      d.classList.remove('rolling');
      d.innerHTML = dieMarkup(i === 0 ? data.d1 : data.d2);
    });

    await sleep(220);
    const who = data.targetName
      ? (data.isDealer ? '庄家本人' : data.targetName)
      : '';
    totalEl.innerHTML = `点 数 <b>${data.total}</b>${who ? ` · ${who}` : ''}`;

    await sleep(950);
    el.style.transition = 'opacity .28s';
    el.style.opacity = '0';
    await sleep(300);
    el.remove();
  });
}

/* ---------------- 切牌 ---------------- */

export function playCut(index) {
  return enqueue(async () => {
    const el = mount(`
      <div class="cut-overlay">
        <div class="cut-stage">
          <div class="cut-rows">
            <div class="cut-row" data-row="0"></div>
            <div class="cut-row" data-row="1"></div>
          </div>
          <div class="cut-arrow">切 牌 · 第 ${index} 墩</div>
        </div>
      </div>`);

    const rows = el.querySelectorAll('.cut-row');
    for (let i = 0; i < 40; i += 1) {
      const target = rows[i < 20 ? 0 : 1];
      const wrap = document.createElement('div');
      wrap.innerHTML = tileHTML(null, { size: 'xs' });
      const node = wrap.firstElementChild;
      node.style.setProperty('--tw', '17px');
      target.appendChild(node);
    }

    await sleep(180);
    // 上叠上移、下叠下移，交换位置
    rows[0].style.transition = 'transform .6s cubic-bezier(.3,.8,.4,1)';
    rows[1].style.transition = 'transform .6s cubic-bezier(.3,.8,.4,1)';
    rows[0].style.transform = 'translateY(64px)';
    rows[1].style.transform = 'translateY(-64px)';
    await sleep(760);

    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    await sleep(320);
    el.remove();
  });
}

/* ---------------- 亮牌提示 ---------------- */

export function playRevealFlash(seatEl) {
  if (!seatEl) return;
  seatEl.animate(
    [
      { boxShadow: '0 0 0 0 rgba(212,176,106,.65)' },
      { boxShadow: '0 0 0 10px rgba(212,176,106,0)' },
    ],
    { duration: 700, easing: 'ease-out' }
  );
}

export function clearFx() {
  const host = root();
  if (host) host.innerHTML = '';
}
