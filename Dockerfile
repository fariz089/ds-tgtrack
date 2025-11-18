# Dockerfile
FROM mcr.microsoft.com/playwright:v1.48.2-jammy

WORKDIR /app

# ⬇️ Jangan download Chrome lagi saat npm install
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/chrome-session /app/public && chown -R pwuser:pwuser /app

ENV BROWSER_HEADLESS=true \
    NODE_ENV=production

USER pwuser

EXPOSE 8080

# ⬇️ Di sini kita deteksi path Chromium bawaan Playwright
CMD export PUPPETEER_EXECUTABLE_PATH=$(ls -d /ms-playwright/chromium-*/chrome-linux/chrome | head -n1) && \
    node index.js
