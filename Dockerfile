# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_ENV=production \
    PORT=9876 \
    TZ=Asia/Shanghai

# 依赖层（利用缓存）
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; \
    else npm install --omit=dev --no-audit --no-fund; fi \
    && npm cache clean --force

# 应用层
COPY server ./server
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node
VOLUME ["/app/data"]
EXPOSE 9876

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9876)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
