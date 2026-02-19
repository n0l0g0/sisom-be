FROM public.ecr.aws/docker/library/node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .
RUN npm run build

FROM public.ecr.aws/docker/library/node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache postgresql-client
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
RUN npm install --omit=dev && npx prisma generate
COPY --from=builder /app/dist ./dist
COPY src/tools ./src/tools
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
