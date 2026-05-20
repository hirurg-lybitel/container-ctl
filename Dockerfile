FROM node:25-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 3080

CMD ["node", "src/index.js"]
