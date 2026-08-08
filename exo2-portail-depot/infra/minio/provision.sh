#!/bin/bash
# Provisionnement du stockage objet : bucket, policy, utilisateur applicatif.
#
# Execute par le conteneur `minio-init` (image minio/mc), qui demarre, joue ce
# script et sort. Rien n'est persiste dans le conteneur, tout l'est dans MinIO.
#
# C'est un conteneur dedie et non l'API, parce que creer un bucket est un acte
# d'administration : tant que l'API le faisait elle-meme, elle devait detenir les
# identifiants root de MinIO, et une compromission donnait tout le stockage.
#
# bash et non sh : l'image mc n'embarque ni sed ni awk, mais elle a bash, dont la
# substitution ${var//a/b} suffit a instancier le gabarit de policy.
#
# Rejouable : chaque commande tolere que son objet existe deja.
set -euo pipefail

POLICY_NAME=portail-app
POLICY_TEMPLATE=/infra/app-policy.json

# MinIO refuse de creer un utilisateur portant le nom du root. Sans ce test,
# l'echec serait un message mc opaque en milieu de journal.
if [ "$STORAGE_ACCESS_KEY" = "$MINIO_ROOT_USER" ]; then
  echo "minio-init: STORAGE_ACCESS_KEY doit differer de MINIO_ROOT_USER" >&2
  exit 1
fi

mc alias set minio "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

mc mb --ignore-existing "minio/$STORAGE_BUCKET"

# Le gabarit porte __BUCKET__ : on l'instancie sans outil externe. `create` est
# rejoue a chaque demarrage et ecrase la definition, donc modifier
# app-policy.json puis relancer suffit a propager la nouvelle policy.
policy="$(cat "$POLICY_TEMPLATE")"
printf '%s' "${policy//__BUCKET__/$STORAGE_BUCKET}" > /tmp/app-policy.json
mc admin policy create minio "$POLICY_NAME" /tmp/app-policy.json

# Reecrit le secret si l'utilisateur existe deja.
mc admin user add minio "$STORAGE_ACCESS_KEY" "$STORAGE_SECRET_KEY"

# minio#16897 rapporte que `attach` echoue quand la policy est DEJA attachee, ce
# qui casserait tout second demarrage. Mesure sur le tag fige ci-dessus : il
# renvoie 0 dans ce cas, le bug ne s'y reproduit pas (il datait de mc 2023).
#
# La garde reste, parce qu'elle ne coute rien et qu'un futur changement de tag
# pourrait le ramener. Mais surtout PAS sous la forme `|| true` : cela avalerait
# aussi les vrais echecs — policy introuvable, utilisateur absent — et l'API
# demarrerait sans droits, avec un refus d'acces sans rapport apparent. On
# demande donc a MinIO ce que l'utilisateur porte vraiment. `grep` n'existe pas
# dans l'image mc, d'ou la correspondance de motif bash.
if ! mc admin policy attach minio "$POLICY_NAME" --user "$STORAGE_ACCESS_KEY" 2>/dev/null; then
  attached="$(mc admin user info minio "$STORAGE_ACCESS_KEY" 2>&1 || true)"
  if [[ "$attached" != *"$POLICY_NAME"* ]]; then
    echo "minio-init: impossible d'attacher la policy $POLICY_NAME" >&2
    echo "$attached" >&2
    exit 1
  fi
fi

echo "minio-init: bucket $STORAGE_BUCKET pret, utilisateur restreint $POLICY_NAME attache."
