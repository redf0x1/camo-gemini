FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist/ ./dist/

# Dashboard HTML
COPY src/dashboard/index.html ./dist/dashboard/

ENV NODE_ENV=production
ENV CAMOFOX_HOST=host.docker.internal
ENV CAMOFOX_PORT=9377

# Dashboard port
EXPOSE 9378

ENTRYPOINT ["node", "dist/index.js"]
