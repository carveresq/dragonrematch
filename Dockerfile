# No native modules, no database -- this is a stateless MVP exhibit app, so a
# plain multi-stage Next.js standalone build is all that's needed (no
# python3/make/g++ toolchain, no persistent volume).

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN groupadd -r app && useradd -r -g app app

# .next/standalone already contains a trimmed node_modules + server.js;
# public/ and .next/static aren't included in it by Next and must be copied
# alongside per Next's own standalone-output instructions.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER app
EXPOSE 3000
CMD ["node", "server.js"]
