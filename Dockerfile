FROM mcr.microsoft.com/playwright:v1.48.2-jammy

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./
RUN npm install --omit=dev

# Tambahkan dependencies Chromium
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxdamage1 \
    libxcomposite1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    fonts-liberation

COPY . .

RUN mkdir -p /app/chrome-session /app/public && chown -R pwuser:pwuser /app

ENV BROWSER_HEADLESS=true \
    NODE_ENV=production

USER pwuser

EXPOSE 8008

CMD export PUPPETEER_EXECUTABLE_PATH=$(ls -d /ms-playwright/chromium-*/chrome-linux/chrome | head -n1) && \
    echo "🧹 Cleaning stale Chrome locks..." && \
    rm -f /app/chrome-session/SingletonLock /app/chrome-session/SingletonSocket /app/chrome-session/SingletonCookie /app/chrome-session/DevToolsActivePort 2>/dev/null; \
    rm -f /app/chrome-session/Default/SingletonLock 2>/dev/null; \
    pkill -9 -f 'chrome-linux/chrome' 2>/dev/null; \
    sleep 1 && \
    node index.js
