# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# Pas de `--mount=type=cache` ici non plus : voir backend/Dockerfile.
RUN pnpm install --frozen-lockfile
COPY . .
# prune --prod ne laisse que `serve` : ni vite, ni typescript dans l'image finale.
RUN pnpm run build && pnpm prune --prod

# Image finale : ni pnpm, ni corepack, ni toolchain de build.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
# .bin/serve est un wrapper shell, mais il fait `exec node` : le shell est
# remplace, il ne reste qu'un seul processus. `-s` assure le fallback SPA.
#
# `-L` (--no-request-logging) n'est PAS cosmetique : par defaut serve ecrit
# l'URL de chaque requete sur sa sortie standard, donc `docker logs frontend`
# contenait `GET /depot/<jeton>` en clair — le jeton meme que nginx masque dans
# son propre journal, sur une machine PARTAGEE avec d'autres candidats. Sans ce
# drapeau, le masquage cote proxy ne protege rien : les deux flux atterrissent
# au meme endroit. Mesure avant correctif :
#   frontend-1 |  HTTP  ... GET /depot/JETON-NEGATIF-4242
ENTRYPOINT ["node_modules/.bin/serve", "-s", "dist", "-l", "3000", "-L"]
