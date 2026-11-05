# ── Stage 1: deps ──────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime ───────────────────────────────────────────────────────
FROM node:20-alpine

# Install yt-dlp + ffmpeg
RUN apk add --no-cache python3 py3-pip ffmpeg curl \
 && pip3 install --break-system-packages yt-dlp \
 && yt-dlp --version

WORKDIR /app

# Copy deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy app source
COPY . .

# Directory where Navidrome music lands (mounted as a volume)
RUN mkdir -p /music

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "main.js"]
