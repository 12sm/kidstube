FROM node:20-alpine

# Install system dependencies
# python3: required by yt-dlp and native node modules
# make, g++: required for building better-sqlite3 native bindings
# ffmpeg: required by yt-dlp for media processing
# curl: used for yt-dlp binary download and healthchecks
RUN apk add --no-cache python3 make g++ ffmpeg curl \
    chromium nss freetype harfbuzz ca-certificates ttf-freefont

# Install yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package files and install dependencies
# Done before copying source so layer is cached unless deps change
COPY package*.json ./
# Skip Playwright browser download — we use system Chromium installed via apk
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev

# Copy application source
COPY . .

# Create persistent data directories
RUN mkdir -p /app/data /app/downloads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3001/health || exit 1

CMD ["node", "src/server.js"]
