#!/usr/bin/env bash
# Rejoue le tout premier test des evaluateurs : cloner le depot sur une machine
# vierge, lancer ./install.sh, attendre. Contrat verifie : sortie 0 ET le
# portail repond.
#
#   ./scripts/test-bare-machine.sh              ubuntu:24.04, palier root
#   ./scripts/test-bare-machine.sh debian:12    une autre image de base
#
# Ce chemin ne s'exerce QUE dans un conteneur, donc c'est celui qui pourrit le
# plus vite. La recette vivait jusqu'ici en commentaire tronque dans CLAUDE.md
# (« bash -c '...' ») et se reperdait a chaque fois.
#
# TROIS CHOSES SONT LOAD-BEARING ICI :
#
# 1. On part de `git archive HEAD`, JAMAIS de l'arbre de travail. Un fichier
#    oublie dans un `git add` n'apparait que comme ca — l'arbre de travail, lui,
#    l'a sous la main et le test passerait a tort.
#
# 2. `-v /var/lib/docker` est obligatoire. Sans lui, le demon imbrique empile
#    overlayfs sur overlayfs et TOUT meurt sur « mount source: "overlay" ...
#    invalid argument » — une panne qui ressemble trait pour trait a un bug du
#    projet et n'en est pas. Elle a deja coute une fausse piste (voir le plan
#    A8, ou un cache BuildKit a ete retire a tort a cause d'elle).
#
# 3. ON N'INSTALLE RIEN DANS LE CONTENEUR. Pas de `apt-get install curl`, rien.
#    C'est tout l'interet : le harnais precedent installait curl avant de lancer
#    le script, donc il validait une machine moins vierge que celle qu'il
#    pretendait simuler — et a laisse passer trois campagnes de mesures un
#    install.sh qui mourait sur `ubuntu:24.04` nu en reclamant `apt install
#    curl`. Ajouter un paquet ici, c'est reintroduire cet angle mort.
#
# PORTEE : ce script exerce le palier ROOT de la cascade docker (id -u = 0 dans
# le conteneur). Les paliers « sudo » et « rootless » restent a verifier a la
# main — voir la section Verification du plan A8.
set -euo pipefail

IMAGE="${1:-ubuntu:24.04}"
PORT=21600

die() { printf '\n\033[31mECHEC\033[0m : %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

cd "$(dirname "$0")/.."
REPO_SUBDIR="$(basename "$PWD")"

command -v docker >/dev/null || die "docker est requis pour lancer ce test."
docker info >/dev/null 2>&1 || die "le demon docker n'est pas joignable."
git rev-parse --git-dir >/dev/null 2>&1 || die "ce n'est pas un depot git."

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
ARCHIVE="$WORKDIR/src.tar"

step "Archive de HEAD (pas de l'arbre de travail)"
# --prefix : l'archive de la racine du depot contient deja exo2-portail-depot/,
# mais ce script doit aussi fonctionner si le depot EST ce dossier.
git archive HEAD -o "$ARCHIVE"
printf '    %s, %s octets\n' "$(git rev-parse --short HEAD)" "$(stat -c %s "$ARCHIVE")"

if ! git diff --quiet HEAD 2>/dev/null; then
  printf '    \033[33mAttention\033[0m : des modifications non commitees ne sont PAS testees.\n'
fi

step "Machine vierge : $IMAGE, sans docker, sans curl, sans rien"
START="$(date +%s)"

# Le script interieur est passe en argument et non par un heredoc imbrique :
# les guillemets de la commande docker et ceux du script ne se marchent pas
# dessus, et les erreurs de citation deviennent visibles.
INNER='
set -e
mkdir -p /app && tar -xf /src.tar -C /app
# Le depot peut etre archive depuis sa racine (le dossier est alors dedans) ou
# depuis le dossier lui-meme.
if [ -d "/app/REPO_SUBDIR" ]; then cd "/app/REPO_SUBDIR"; else cd /app; fi

echo "--- etat initial de la machine ---"
for tool in docker curl wget git node pnpm; do
  if command -v "$tool" >/dev/null; then echo "  $tool: present"; else echo "  $tool: ABSENT"; fi
done
echo "----------------------------------"

# Pas de `rc=$?` apres un appel nu : sous set -e, un install.sh en echec
# interrompt avant l affectation et le code serait perdu.
if ! ./install.sh; then
  echo
  echo "=== ASSERTIONS ==="
  echo "  [KO] install.sh est sorti en erreur — les assertions suivantes n ont plus de sens."
  exit 1
fi

echo
echo "=== ASSERTIONS ==="
fail=0

# curl est forcement la maintenant : install.sh l a installe lui-meme. C est en
# soi la preuve que ensure_fetcher a fonctionne.
command -v curl >/dev/null || { echo "  [KO] curl absent apres install.sh"; fail=1; }

code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://127.0.0.1:PORT/" || echo 000)
if [ "$code" = 200 ]; then echo "  [OK] portail /            -> 200"
else echo "  [KO] portail /            -> $code (attendu 200)"; fail=1; fi

# 403 est le SEUL temoin fiable que notre nginx.conf est monte : une conf
# absente donne la page d accueil nginx, ou / repond 200 quand meme.
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://127.0.0.1:PORT/api/v1/health" || echo 000)
if [ "$code" = 403 ]; then echo "  [OK] sonde /api/v1/health -> 403 (deny voulu)"
else echo "  [KO] sonde /api/v1/health -> $code (attendu 403 : notre nginx.conf n est peut-etre pas monte)"; fail=1; fi

perms=$(stat -c %a .env)
if [ "$perms" = 600 ]; then echo "  [OK] .env                 -> 600"
else echo "  [KO] .env                 -> $perms (attendu 600)"; fail=1; fi

exit $fail
'
INNER="${INNER//REPO_SUBDIR/$REPO_SUBDIR}"
INNER="${INNER//PORT/$PORT}"

RC=0
docker run --rm --privileged \
  -v /var/lib/docker \
  -v "$ARCHIVE:/src.tar:ro" \
  "$IMAGE" bash -c "$INNER" || RC=$?

ELAPSED=$(( $(date +%s) - START ))

printf '\n'
if [ "$RC" -eq 0 ]; then
  printf '\033[32mSUCCES\033[0m : machine vierge -> portail servi, en %s min %s s.\n' \
    "$((ELAPSED / 60))" "$((ELAPSED % 60))"
else
  die "le parcours machine vierge a echoue (code $RC) apres ${ELAPSED}s. Les assertions ci-dessus disent laquelle."
fi
