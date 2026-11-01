import path from 'node:path';
import fs from 'node:fs';

// 容器内部端口固定为 9876（需求硬性约束），如需本地调试可用 PORT 覆盖
export const PORT = Number(process.env.PORT || 9876);
export const HOST = process.env.HOST || '0.0.0.0';

export const ROOT_DIR = path.resolve(process.cwd());
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// 会话有效期（毫秒）
export const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;
// 游客临时会话在内存中保留的时长
export const GUEST_TTL = 1000 * 60 * 60 * 12;
