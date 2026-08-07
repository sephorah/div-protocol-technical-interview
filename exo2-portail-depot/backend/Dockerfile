# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /app
# pnpm-workspace.yaml porte `allowBuilds` : pnpm 11 traite un script de build
# ignore comme une erreur, meme quand ce script est inutile ici.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# `pnpm run build` enchaine `prisma generate` puis `nest build`. Le client est
# genere dans src/generated/, donc compile dans dist/ — hors de node_modules,
# et par consequent hors d'atteinte du prune ci-dessous.
RUN pnpm run build && pnpm prune --prod

# Image finale : ni pnpm, ni corepack, ni sources TypeScript.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Le CLI Prisma applique les migrations au demarrage : il lui faut le schema et
# les fichiers de migration. `prisma` est en dependencies (pas en
# devDependencies) pour survivre au `pnpm prune --prod`.
#
# prisma.config.js est embarque : Prisma 7 interdit `url` dans le schema, donc
# c'est le seul endroit ou le CLI trouve la chaine de connexion. Il est ecrit en
# JavaScript pour ne dependre d'aucun chargeur TypeScript apres le prune.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.js ./prisma.config.js
COPY --from=build /app/docker-entrypoint.sh ./docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
