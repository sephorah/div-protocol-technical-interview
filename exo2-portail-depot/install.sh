#!/usr/bin/env bash
# Point d'entree du projet, prevu pour une machine vierge : il installe ce qui
# manque (Node, pnpm), puis installe les dependances, build, et lance l'app.
#
#   ./install.sh          installe, build et lance backend + frontend en local
#   ./install.sh --build  s'arrete apres le build (CI, ou avant un docker compose)
#
# pipefail : un pipe echoue si n'importe quel maillon echoue, pas seulement le dernier.
set -euo pipefail

cd "$(dirname "$0")"

NODE_VERSION=22        # branche installee par nvm si Node manque
NODE_MIN=22.13.0       # minimum reel : en dessous, pnpm 11 refuse de demarrer
PNPM_VERSION=11.20.0
NVM_VERSION=v0.40.6    # epinglee : `curl | bash` sur une branche mouvante n'est pas reproductible
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

die() { echo "Erreur : $*" >&2; exit 1; }
step() { echo; echo "==> $*"; }
usage() {
  echo "Usage : ./install.sh [--build]"
  echo "  (sans argument)  installe, build et lance backend + frontend"
  echo "  --build          s'arrete apres le build"
}

# Arguments valides en tete de script : sinon une faute de frappe (`--biuld`) se
# paie apres un build complet, et demarre les serveurs au lieu de s'arreter.
BUILD_ONLY=0
[ "$#" -le 1 ] || die "un seul argument est accepte (recu : $*)."
case "${1:-}" in
  '')          ;;
  --build)     BUILD_ONLY=1 ;;
  -h|--help)   usage; exit 0 ;;
  *)           die "argument inconnu : $1 (attendu : --build, --help, ou aucun)." ;;
esac

# Comparaison sur les trois composantes : tester la majeure seule laisserait
# passer un Node 22.0-22.12, trop ancien pour pnpm 11, avec un echec plus loin
# dont le message ne designe pas la cause.
node_ok() {
  command -v node >/dev/null || return 1
  node -e '
    const min = process.argv[1].split(".").map(Number);
    const cur = process.versions.node.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if (cur[i] > min[i]) process.exit(0);
      if (cur[i] < min[i]) process.exit(1);
    }
  ' "$NODE_MIN" 2>/dev/null
}

# nvm.sh lit des variables non definies et n'est pas compatible avec `set -u`.
# PREFIX / NPM_CONFIG_PREFIX (souvent poses par un ancien npm ou un toolchain
# croise) font echouer `nvm use` : on les retire pour la duree du script.
load_nvm() {
  unset PREFIX NPM_CONFIG_PREFIX
  set +u
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  set -u
}

step "Verification de Node (>= ${NODE_MIN})"
if node_ok; then
  echo "Node $(node -v) deja present."
else
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "Node absent ou trop ancien, et nvm introuvable : installation de nvm ${NVM_VERSION}."
    nvm_url="https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh"
    # PROFILE=/dev/null : l'installeur n'ecrit pas dans le .bashrc de l'utilisateur.
    # C'est a lui de decider ; le script charge nvm lui-meme, plus bas.
    if command -v curl >/dev/null; then
      curl -fsSL "$nvm_url" | PROFILE=/dev/null bash
    elif command -v wget >/dev/null; then
      wget -qO- "$nvm_url" | PROFILE=/dev/null bash
    else
      die "curl ou wget est requis pour installer nvm (apt install curl / dnf install curl)."
    fi
  fi
  [ -s "$NVM_DIR/nvm.sh" ] || die "nvm introuvable dans ${NVM_DIR} apres installation."
  load_nvm
  echo "Installation de Node ${NODE_VERSION} via nvm."
  nvm install "$NODE_VERSION"
  nvm alias default "$NODE_VERSION"
  nvm use "$NODE_VERSION"
  hash -r   # bash met en cache le chemin des binaires : sans ca, l'ancien node reste resolu
  node_ok || die "Node >= ${NODE_MIN} toujours indisponible apres installation via nvm."
  echo "Node $(node -v) installe."
  echo "Note : ce shell-ci seulement. Pour vos prochains terminaux, ouvrez-en un nouveau"
  echo "       ou ajoutez nvm a votre profil (voir ${NVM_DIR}/nvm.sh)."
fi

# corepack est livre avec Node et fournit le pnpm epingle par `packageManager`.
# `npm i -g pnpm` installerait une version non epinglee : on ne s'en sert pas.
step "Verification de pnpm (${PNPM_VERSION})"
if [ "$(pnpm --version 2>/dev/null || true)" = "$PNPM_VERSION" ]; then
  echo "pnpm ${PNPM_VERSION} deja present."
else
  command -v corepack >/dev/null || die "corepack introuvable alors qu'il est livre avec Node ${NODE_VERSION}."
  # --install-directory : force le shim a cote du node courant, sinon un shim
  # systeme prioritaire dans le PATH peut masquer la version qu'on active.
  shim_dir="$(dirname "$(command -v node)")"
  # Mais si Node vient du systeme (/usr/bin/node), ce dossier n'est pas
  # inscriptible sans root et corepack echoue en EACCES. On se rabat alors sur
  # un dossier utilisateur, place en tete du PATH pour la duree du script.
  if [ ! -w "$shim_dir" ]; then
    shim_dir="$HOME/.local/bin"
    mkdir -p "$shim_dir"
    export PATH="$shim_dir:$PATH"
    echo "Node est installe au niveau systeme (dossier non inscriptible) :"
    echo "shim pnpm place dans ${shim_dir}. Ajoutez-le a votre PATH pour le"
    echo "retrouver dans vos autres terminaux."
  fi
  corepack enable --install-directory "$shim_dir"
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
  hash -r
  echo "pnpm $(pnpm --version) actif."
fi

step "Installation des dependances (backend + frontend)"
pnpm run install:all

step "Build"
pnpm run build

if [ "$BUILD_ONLY" = 1 ]; then
  step "Build termine."
  exit 0
fi

step "Demarrage : API sur :3000, frontend sur :4000 (Ctrl+C pour arreter)"
exec pnpm run start
