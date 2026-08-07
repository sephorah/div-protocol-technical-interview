#!/bin/sh
# Entrypoint du conteneur backend : appliquer les migrations, puis demarrer.
#
# `set -e` : si les migrations echouent, on ne demarre pas une API branchee sur
# un schema dans un etat inconnu. Le conteneur sort en erreur, `restart:
# unless-stopped` le relance, et `docker compose logs` porte la cause.
set -e

echo "==> Application des migrations (prisma migrate deploy)"
# Joue a chaque demarrage, donc a chaque replique. Prisma prend un verrou
# consultatif Postgres : deux repliques ne migrent pas en meme temps, la
# seconde attend la fin de la premiere avant de demarrer. Sans objet a une
# instance ; a sortir dans un job dedie le jour ou l'API est repliquee.
node_modules/.bin/prisma migrate deploy

echo "==> Demarrage de l'API"
# `exec` : node remplace le shell et devient le processus surveille. Sans lui,
# le shell resterait le parent et n'aurait aucune raison de transmettre
# SIGTERM — les arrets prendraient les 10 s de timeout de `docker stop`.
exec node dist/main
