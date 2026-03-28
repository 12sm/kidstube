# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy frontend package files (context is repo root)
COPY frontend/package*.json ./
RUN npm install

# Copy frontend source
COPY frontend/ .

# Build production bundle
RUN npm run build

# Serve stage
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx server config (from repo root, since build context is root)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:80 || exit 1

CMD ["nginx", "-g", "daemon off;"]
