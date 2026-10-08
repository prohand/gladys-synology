FROM node:24-alpine AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine

# dumb-init as PID 1: Node does not reap zombies nor get the kernel's default signal handling
# there, so SIGTERM from the Gladys supervisor would not reach the graceful shutdown reliably.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
WORKDIR /app

# Copied as root and only read at runtime: the rootfs is read-only in the Gladys sandbox and the
# only thing written (the DSM trusted device) goes to /data, so no chown is needed.
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json index.js ./
COPY src ./src

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
