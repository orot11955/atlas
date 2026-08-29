FROM node:24-alpine AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @atlas/admin-web build

FROM node:24-alpine AS runtime

WORKDIR /workspace
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY --from=build /workspace /workspace

EXPOSE 3000
CMD ["pnpm", "--filter", "@atlas/admin-web", "start"]
