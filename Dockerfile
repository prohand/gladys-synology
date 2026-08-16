FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
CMD ["node", "src/index.js"]
