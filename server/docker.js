import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 容器内一键更新支持
 *
 * 前提：docker-compose.yml 里挂了 /var/run/docker.sock
 *   - 没挂载时所有接口优雅降级（enabled=false），前端提示手动更新
 *
 * 更新流程：
 *   1. 查 GitHub 最新 release，对比当前版本
 *   2. 拉取新镜像（docker pull）
 *   3. 用 docker:cli 临时容器执行 docker compose up -d 重建本容器
 *      （不能只 restart —— restart 不会重新解析 :latest 标签）
 *
 * 项目目录不写死：从自身容器的 Mounts 里反推（/app/data 的 Source 的父目录），
 * 这样用户把项目放哪都能用。
 */

const SOCK = process.env.DOCKER_SOCK || '/var/run/docker.sock';
const IMAGE = process.env.IMAGE_NAME || 'ghcr.io/maimengdexiaolaba/jiuzhuo-game';
const TAG = process.env.IMAGE_TAG || 'latest';
const REPO = process.env.GITHUB_REPO || 'Maimengdexiaolaba/jiuzhuo-game';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 当前应用版本（读 package.json） */
export function currentVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** docker.sock 是否可用 */
export function dockerAvailable() {
  try {
    return fs.existsSync(SOCK);
  } catch {
    return false;
  }
}

/** 调 Docker Engine API（unix socket） */
function dockerRequest(method, apiPath, body = null, { raw = false, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        socketPath: SOCK,
        path: apiPath,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            let msg = data;
            try { msg = JSON.parse(data).message || data; } catch { /* 保留原文 */ }
            reject(new Error(`Docker API ${res.statusCode}: ${msg}`));
            return;
          }
          if (raw) { resolve(data); return; }
          try { resolve(data ? JSON.parse(data) : null); } catch { resolve(data); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('Docker API 超时')));
    if (payload) req.write(payload);
    req.end();
  });
}

/** 自身容器 ID（容器内 hostname 默认就是短 ID） */
function selfId() {
  return os.hostname();
}

/** 从自身挂载信息反推宿主机项目目录 */
async function resolveProjectDir() {
  const info = await dockerRequest('GET', `/containers/${selfId()}/json`);
  const mounts = info?.Mounts || [];
  const dataMount = mounts.find((m) => m.Destination === '/app/data');
  if (dataMount?.Source) return path.posix.dirname(dataMount.Source);
  // 兜底：用第一个 bind 挂载的父目录
  const bind = mounts.find((m) => m.Type === 'bind' && m.Source);
  if (bind) return path.posix.dirname(bind.Source);
  return null;
}

/** 本地镜像信息（是否有 :latest） */
async function localImage() {
  try {
    return await dockerRequest('GET', `/images/${encodeURIComponent(`${IMAGE}:${TAG}`)}/json`);
  } catch {
    return null;
  }
}

/** 查 GitHub 最新 release */
async function latestRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'jiuzhuo-game', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      tag: (data.tag_name || '').replace(/^v/, '') || null,
      name: data.name || data.tag_name || '',
      url: data.html_url || '',
      publishedAt: data.published_at || '',
    };
  } catch {
    return null;
  }
}

/** 检查更新（不改动任何东西） */
export async function checkUpdate() {
  const current = currentVersion();
  const enabled = dockerAvailable();
  const [release, image] = await Promise.all([
    latestRelease(),
    enabled ? localImage() : Promise.resolve(null),
  ]);

  const latest = release?.tag || null;
  const hasNewVersion = !!(latest && latest !== current);
  return {
    enabled,
    current,
    latest,
    releaseUrl: release?.url || '',
    publishedAt: release?.publishedAt || '',
    hasUpdate: hasNewVersion,
    // 本地镜像创建时间，便于排查「拉过没生效」
    imageCreated: image?.Created || null,
    imageSize: image?.Size || 0,
    message: enabled
      ? (hasNewVersion ? `发现新版本 v${latest}` : '已是最新版本')
      : '未挂载 docker.sock，无法一键更新',
  };
}

/**
 * 第一步：拉镜像 + 准备 docker:cli
 * 这一步不会影响运行中的容器，可以安全地等它跑完再回响应
 */
export async function prepareUpdate() {
  if (!dockerAvailable()) throw new Error('未挂载 docker.sock，请按文档手动更新');

  const projectDir = await resolveProjectDir();
  if (!projectDir) throw new Error('无法定位宿主机项目目录（/app/data 未挂载？）');

  // 1. 拉取最新镜像
  await dockerRequest(
    'POST',
    `/images/create?fromImage=${encodeURIComponent(IMAGE)}&tag=${encodeURIComponent(TAG)}`,
    null,
    { raw: true },
  );

  // 2. 准备 docker:cli（首次需要联网拉取）
  const cliImage = 'docker:cli';
  try {
    await dockerRequest('GET', `/images/${encodeURIComponent(cliImage)}/json`);
  } catch {
    await dockerRequest('POST', `/images/create?fromImage=docker&tag=cli`, null, { raw: true });
  }

  return { projectDir, image: `${IMAGE}:${TAG}` };
}

/**
 * 第二步：起临时容器执行 compose up -d 重建本容器
 * 独立于本容器进程，所以本容器被杀也能完整跑完
 */
export async function triggerRebuild(projectDir) {
  const composeFile = '/work/docker-compose.yml';
  const cmd = [
    'sh', '-c',
    `docker compose -f ${composeFile} --project-directory /work pull && ` +
    `docker compose -f ${composeFile} --project-directory /work up -d`,
  ];
  const helper = await dockerRequest('POST', '/containers/create', {
    Image: 'docker:cli',
    Cmd: cmd,
    HostConfig: {
      AutoRemove: true,
      Binds: [
        `${SOCK}:/var/run/docker.sock`,
        `${projectDir}:/work`,
      ],
    },
  });
  await dockerRequest('POST', `/containers/${helper.Id}/start`);
  return { ok: true, helperId: helper.Id };
}

/** 拉取进度（供前端轮询展示，简化版：只返回镜像是否已变） */
export async function pullStatus() {
  const image = await localImage();
  return {
    imageCreated: image?.Created || null,
    imageSize: image?.Size || 0,
  };
}
