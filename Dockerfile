# 《眠海》平台（WhiteRoom）生产镜像
FROM node:20-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# 仅安装生产依赖（acorn / jose / ws / yauzl），利用层缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# 数据目录挂持久卷；以非 root 运行
RUN mkdir -p /var/lib/whiteroom && chown -R node:node /var/lib/whiteroom /app
USER node
VOLUME ["/var/lib/whiteroom"]

ENV HOST=0.0.0.0 \
    PORT=8787 \
    WHITEROOM_DATA_DIR=/var/lib/whiteroom

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
