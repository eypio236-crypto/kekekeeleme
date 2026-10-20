FROM node:18-slim

# Puppeteer için gerekli sistem bağımlılıkları
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    fonts-dejavu-core \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer, kendi Chromium'unu indirmesin; sistem Chromium'unu kullansın
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
