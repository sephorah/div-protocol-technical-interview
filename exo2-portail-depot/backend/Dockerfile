# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /app
# pnpm-workspace.yaml porte `allowBuilds` : pnpm 11 traite un script de build
# ignore comme une erreur, meme quand ce script est inutile ici.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Volontairement SANS `--mount=type=cache` sur le store pnpm : son gain porte
# sur les rebuilds, que le parcours one-click ne fait jamais — l'evaluateur
# construit une fois. Sur ce build-la, il ne fait economiser que les paquets
# communs aux deux images. Pas assez pour ajouter une dependance a une
# fonctionnalite BuildKit sur le chemin qui doit marcher partout.
# La mise en cache qui compte reste celle des couches : les manifestes sont
# copies avant les sources, donc une modification de code ne reinstalle rien.
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
# prisma.config.ts est embarque : Prisma 7 interdit `url` dans le schema, donc
# c'est le seul endroit ou le CLI trouve la chaine de connexion. Il reste en
# TypeScript parce que le CLI le charge via jiti (prisma -> @prisma/config ->
# c12 -> jiti, toutes en dependencies) : aucun besoin du paquet `typescript`,
# que `pnpm prune --prod` a bien supprime.
#
# src/config/ suit, parce que prisma.config.ts importe buildDatabaseUrl depuis
# les sources — il ne peut pas viser dist/, qui n'existe pas encore quand
# `prisma generate` tourne au debut de `pnpm build`. Deux fichiers, contre une
# seconde implementation de l'assemblage d'URL qui pourrait diverger.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/src/config ./src/config
COPY --from=build /app/docker-entrypoint.sh ./docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
