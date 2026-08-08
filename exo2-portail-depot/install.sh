#!/usr/bin/env bash
# Point d'entree du projet, prevu pour une machine vierge.
#
#   ./install.sh          monte toute la stack et affiche les URLs
#   ./install.sh --build  construit les images sans demarrer (CI)
#
# Contrat : quand ce script rend la main sans erreur, l'application repond.
# Pas « les conteneurs sont lances » — le portail repond. Il n'y a aucune
# commande a taper ensuite, et rien a lire dans le README pour y arriver.
#
# Le developpement au quotidien, lui, n'utilise pas ce script : c'est
# `pnpm db:up && pnpm dev`, qui suppose Node et pnpm deja installes.
#
# pipefail : un pipe echoue si n'importe quel maillon echoue, pas seulement le dernier.
set -euo pipefail

cd "$(dirname "$0")"

HTTP_PORT=21600           # port attribue, cible du proxy de la machine
HEALTH_TIMEOUT=300        # secondes d'attente maximale des healthchecks
SERVICES="db minio backend frontend proxy"

# Toutes les commandes docker passent par $DOCKER : selon la machine, ce sera
# `docker` ou `sudo docker` (voir la cascade d'installation plus bas).
DOCKER="docker"

die() { printf '\nErreur : %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

usage() {
  echo "Usage : ./install.sh [--build]"
  echo "  (sans argument)  monte la stack complete et affiche les URLs"
  echo "  --build          construit les images sans demarrer"
}

# Arguments valides en tete de script : sinon une faute de frappe (`--biuld`) se
# paie apres plusieurs minutes de build, et demarre la stack au lieu de s'arreter.
BUILD_ONLY=0
[ "$#" -le 1 ] || die "un seul argument est accepte (recu : $*)."
case "${1:-}" in
  '')          ;;
  --build)     BUILD_ONLY=1 ;;
  -h|--help)   usage; exit 0 ;;
  *)           die "argument inconnu : $1 (attendu : --build, --help, ou aucun)." ;;
esac

# --------------------------------------------------------------------------
# Docker
# --------------------------------------------------------------------------
# On ne sait pas ce qu'il y a sur la machine de test, ni si l'utilisateur a les
# droits. Le script descend donc une cascade et ne s'arrete qu'apres l'avoir
# epuisee : docker deja utilisable -> installation privilegiee -> installation
# rootless dans $HOME.

docker_usable() { $DOCKER info >/dev/null 2>&1; }

compose_v2_present() { $DOCKER compose version >/dev/null 2>&1; }

# `sudo -v` valide (et met en cache) les droits. Appele une seule fois, tot :
# l'eventuelle invite de mot de passe arrive avant les minutes de build, pas au
# milieu. `sudo -n` teste d'abord le cas sans mot de passe, pour ne rien
# demander quand ce n'est pas necessaire.
can_sudo() {
  command -v sudo >/dev/null || return 1
  sudo -n true 2>/dev/null && return 0
  [ -t 0 ] || return 1   # pas de terminal : impossible de saisir un mot de passe
  info "Docker doit etre installe, ce qui demande les droits administrateur."
  sudo -v
}

install_docker_privileged() {
  local sudo_cmd=""
  [ "$(id -u)" -eq 0 ] || sudo_cmd="sudo"
  info "Installation via le script officiel https://get.docker.com"
  curl -fsSL https://get.docker.com | ${sudo_cmd} sh
  ${sudo_cmd} systemctl enable --now docker 2>/dev/null \
    || ${sudo_cmd} service docker start 2>/dev/null \
    || true
  # Ni systemd ni SysV : c'est le cas d'un conteneur ou de WSL sans systemd,
  # ou le demon existe mais n'est lance par personne. On le lance nous-memes.
  if ! ${sudo_cmd} docker info >/dev/null 2>&1; then
    info "Aucun gestionnaire de services : demarrage direct du demon."
    ${sudo_cmd} sh -c 'dockerd >/tmp/dockerd.log 2>&1 &'
    local waited=0
    until ${sudo_cmd} docker info >/dev/null 2>&1; do
      [ "$waited" -ge 30 ] && break
      sleep 1; waited=$((waited + 1))
    done
  fi
}

# Le demon ecoute sur /var/run/docker.sock, en root:docker mode 660 : il faut
# etre root ou membre du groupe `docker`. Une installation neuve cree le groupe
# sans y mettre personne, et l'appartenance n'est lue qu'a l'ouverture de
# session — `usermod -aG` ne change donc rien pour le shell en cours. On termine
# le run en `sudo docker`, et on dit comment s'en passer la prochaine fois.
use_sudo_docker_for_this_run() {
  DOCKER="sudo docker"
  info "Ce run utilise sudo pour parler a docker. Pour les suivants :"
  info "  sudo usermod -aG docker $USER    (puis rouvrir la session)"
}

install_docker_rootless() {
  info "Pas de droits administrateur : installation de Docker en mode rootless."
  command -v newuidmap >/dev/null || die \
    "le mode rootless exige newuidmap (paquet 'uidmap'), absent, et son
       installation demande les droits administrateur. Faites lancer :
         sudo apt-get install -y uidmap     (Debian/Ubuntu)
         sudo dnf install -y shadow-utils   (Fedora/RHEL)
       ou installez docker : curl -fsSL https://get.docker.com | sudo sh"
  # L'installeur rootless verifie lui-meme ses prerequis (iptables, modules
  # noyau, sous-uid) et affiche les commandes manquantes. On encadre son echec
  # pour que la sortie ne se termine pas sur ses instructions sans contexte.
  curl -fsSL https://get.docker.com/rootless | sh || die \
    "l'installation de Docker rootless a echoue (prerequis manquants ci-dessus).
       Ces prerequis s'installent avec les droits administrateur. Le plus simple
       est alors de faire installer docker normalement :
         curl -fsSL https://get.docker.com | sudo sh
         sudo usermod -aG docker $USER    (puis rouvrir la session)"
  export PATH="$HOME/bin:$PATH"
  export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"
  # setsid + nohup : le demon doit survivre a la fin de ce script et a la
  # fermeture du terminal. Lance en simple `&`, il resterait rattache a la
  # session — le fermer emporterait le demon, et la stack deviendrait
  # impilotable alors que les conteneurs, eux, tournent encore.
  setsid nohup "$HOME/bin/dockerd-rootless.sh" >/tmp/dockerd-rootless.log 2>&1 &
  disown 2>/dev/null || true
  # Le demon met un instant a ouvrir sa socket.
  local waited=0
  until docker info >/dev/null 2>&1; do
    [ "$waited" -ge 30 ] && die "le demon rootless n'a pas demarre (voir /tmp/dockerd-rootless.log)."
    sleep 1; waited=$((waited + 1))
  done
  info "Docker rootless actif. Pour vos prochains terminaux :"
  info "  export PATH=\$HOME/bin:\$PATH"
  info "  export DOCKER_HOST=$DOCKER_HOST"
}

step "Verification de Docker"
if docker_usable && compose_v2_present; then
  info "Docker $($DOCKER --version | awk '{print $3}' | tr -d ,) deja utilisable."
elif command -v docker >/dev/null && ! docker_usable && can_sudo && sudo docker info >/dev/null 2>&1; then
  # Docker est la et tourne, mais l'utilisateur n'est pas dans le groupe.
  use_sudo_docker_for_this_run
else
  command -v curl >/dev/null || die "curl est requis pour installer docker (apt install curl / dnf install curl)."
  if [ "$(id -u)" -eq 0 ]; then
    install_docker_privileged
  elif can_sudo; then
    install_docker_privileged
    docker_usable || use_sudo_docker_for_this_run
  else
    install_docker_rootless
  fi
  docker_usable || die "docker reste injoignable apres installation."
  compose_v2_present || die \
    "le plugin 'docker compose' v2 est absent (l'ancien 'docker-compose' v1 ne
       convient pas). Installez-le : sudo apt-get install -y docker-compose-plugin"
  info "Docker installe et operationnel."
fi

# --------------------------------------------------------------------------
# Port
# --------------------------------------------------------------------------
# Teste AVANT le build : sinon l'echec arrive apres plusieurs minutes. Un port
# tenu par notre propre proxy n'est pas un conflit — compose recree le
# conteneur — sinon un second ./install.sh echouerait sur lui-meme.
port_is_ours() {
  local ids; ids="$($DOCKER compose ps -q proxy 2>/dev/null || true)"
  [ -n "$ids" ]
}

# Retourne 0 si le port est libre, 1 s'il est pris, 2 si on n'a pas su decider.
# La distinction compte : un `docker run` qui echoue peut l'avoir fait pour tout
# autre chose (image inaccessible, reseau coupe), et annoncer « port occupe »
# dans ce cas enverrait chercher un conflit qui n'existe pas.
port_state() {
  if command -v ss >/dev/null; then
    ss -ltnH "sport = :$1" 2>/dev/null | grep -q . && return 1
    return 0
  fi
  # Sans `ss` : bash sait ouvrir une connexion TCP sans aucune dependance.
  # Une connexion qui aboutit prouve que quelque chose ecoute ; un echec ne
  # prouve rien de plus que « personne n'a repondu », ce qui suffit ici.
  if timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" 2>/dev/null; then
    return 1
  fi
  return 0
}

step "Verification du port $HTTP_PORT"
# `port_state ...; status=$?` ne convient pas : sous `set -e`, une commande
# simple qui renvoie non-zero interrompt le script avant l'affectation, et
# l'echec devient muet. Le `||` protege l'appel.
port_status=0
port_state "$HTTP_PORT" || port_status=$?
if [ "$port_status" -eq 0 ] || port_is_ours; then
  info "Disponible."
else
  info "Occupe par :"
  (command -v ss >/dev/null && ss -ltnp "sport = :$HTTP_PORT" 2>/dev/null | tail -n +2) || true
  die "le port $HTTP_PORT est deja utilise par un autre programme.
       C'est le port attribue a ce projet (plage 21600-21699) : liberez-le, ou
       arretez la pile qui l'occupe."
fi

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
# Secret aleatoire sans dependance : /dev/urandom, od et tr sont partout ou
# tourne bash. L'hexadecimal evite tout caractere a echapper dans un .env.
random_hex() { head -c "${1:-32}" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# Remplace la valeur d'une cle en conservant les commentaires de .env.example,
# qui sont la documentation des variables.
set_env_value() {
  local key="$1" value="$2"
  # La valeur peut contenir n'importe quoi : on passe par awk plutot que par
  # une substitution sed, ou un `&` ou un `/` seraient interpretes.
  awk -v k="$key" -v v="$value" \
    'BEGIN{FS=OFS="="} $1==k && !done {print k "=" v; done=1; found=1; next} {print}
     END{ if (!found) exit 3 }' \
    .env > .env.tmp || {
      rm -f .env.tmp
      die "la cle $key est absente de .env.example : le .env genere serait
       incomplet et l'echec n'apparaitrait qu'au demarrage. Corrigez
       .env.example ou install.sh — les deux doivent lister les memes cles."
    }
  mv .env.tmp .env
}

# Vrai si la cle est absente de .env, ou presente avec une valeur vide.
env_value_missing() {
  ! grep -qE "^$1=." .env 2>/dev/null
}

# Ne renseigne la cle que si elle est vide : une valeur deja choisie par
# l'utilisateur n'est jamais ecrasee. La forme `if` et non `&&` est volontaire :
# `a && b` renverrait 1 quand la cle est deja remplie, ce que `set -e`
# interpreterait comme un echec du script.
set_env_default() {
  if env_value_missing "$1"; then
    set_env_value "$1" "$2"
  fi
}

# Reporte dans .env les cles que .env.example a gagnees depuis sa creation.
#
# Sans cela, un .env genere avant l'ajout d'une variable requise reste perime :
# `docker compose up` echoue sur `${VAR:?}` et le script ne rend plus la main en
# 0, alors que c'est son contrat. Les commentaires de .env.example sont repris,
# ils sont la documentation de la variable.
# Ecrit le nombre de cles ajoutees sur la sortie standard ; le fichier, lui, est
# modifie en place.
append_missing_keys() {
  local added=0 key
  # Boucle alimentee par un heredoc et non par un pipe : `grep | while` execute
  # la boucle dans un sous-shell, ou l'incrementation du compteur serait perdue.
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    grep -qE "^$key=" .env && continue
    awk -v k="$key" '
      # Accumule le bloc de commentaires en cours et ne l imprime qu avec la
      # cle qu il documente.
      /^#/ { block = block $0 "\n"; next }
      $0 ~ "^" k "=" { printf "\n%s%s\n", block, $0; exit }
      { block = "" }
    ' .env.example >> .env
    added=$((added + 1))
  done <<EOF
$(grep -oE '^[A-Z_][A-Z0-9_]*=' .env.example | tr -d '=')
EOF
  printf '%s\n' "$added"
}

step "Configuration (.env)"
[ -f .env.example ] || die ".env.example est introuvable — le depot est incomplet."
# umask avant toute ecriture : set_env_value passe par un fichier temporaire qui
# contiendrait le mot de passe en clair et lisible par tous, meme une fraction
# de seconde.
umask 077

if [ -f .env ]; then
  added="$(append_missing_keys)"
  if [ "$added" -gt 0 ]; then
    info ".env existant : $added variable(s) ajoutee(s) depuis .env.example."
  else
    info ".env existant : deja complet, conserve tel quel."
  fi
else
  cp .env.example .env
  info ".env genere depuis .env.example."
fi

# Idempotent : ne remplit que ce qui est vide, donc rejouable sur un .env
# partiel comme sur un .env neuf.
set_env_default DB_USER portail
set_env_default DB_NAME portail_depot
set_env_default DB_PASSWORD "$(random_hex 32)"
set_env_default JWT_SECRET "$(random_hex 32)"
# Identifiants MinIO : l'API les utilise pour creer le bucket, et le conteneur
# minio les recoit comme identifiants root. Une seule paire, deux lecteurs.
set_env_default STORAGE_ACCESS_KEY "$(random_hex 16)"
set_env_default STORAGE_SECRET_KEY "$(random_hex 32)"

# chmod APRES les substitutions : set_env_value ecrit un fichier temporaire puis
# le deplace, ce qui reinitialiserait les permissions au umask.
chmod 600 .env

# --------------------------------------------------------------------------
# Build et demarrage
# --------------------------------------------------------------------------
if [ "$BUILD_ONLY" = 1 ]; then
  step "Construction des images"
  $DOCKER compose build
  step "Build termine."
  exit 0
fi

step "Construction des images et demarrage de la stack"
info "Le premier appel construit deux images : comptez quelques minutes."
$DOCKER compose up --build -d

# --------------------------------------------------------------------------
# Attente
# --------------------------------------------------------------------------
# C'est cette etape qui fait la difference entre « le script a rendu la main »
# et « l'application repond ». Les migrations sont jouees par l'entrypoint du
# backend : un backend healthy signifie qu'elles sont passees.
health_of() {
  local id; id="$($DOCKER compose ps -q "$1" 2>/dev/null || true)"
  [ -n "$id" ] || { echo "absent"; return; }
  $DOCKER inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo absent
}

step "Attente des services (migrations comprises)"
waited=0
while :; do
  pending=""
  for service in $SERVICES; do
    case "$(health_of "$service")" in
      healthy|running) ;;
      *) pending="$pending $service" ;;
    esac
  done
  [ -z "$pending" ] && break

  if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
    printf '\n'
    $DOCKER compose ps
    for service in $pending; do
      printf '\n--- %s ---\n' "$service"
      $DOCKER compose logs --tail=50 "$service"
    done
    die "services toujours pas prets apres ${HEALTH_TIMEOUT}s :$pending"
  fi

  printf '.'
  sleep 2
  waited=$((waited + 2))
done
printf '\n'
# Derive de $SERVICES et non ecrit en dur : la liste avait cesse de mentionner
# minio alors que la boucle l'attendait deja.
info "$(echo "$SERVICES" | tr ' ' ',' | sed 's/,/, /g') : healthy."

# Les healthchecks sondent depuis l'interieur des conteneurs. Ils prouvent que
# nginx sert, pas que la publication du port fonctionne depuis la machine —
# or c'est cela, le contrat. Verification cote hote, en bash pur : si curl est
# la on va jusqu'au code HTTP, sinon on se contente d'ouvrir la connexion.
if command -v curl >/dev/null; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$HTTP_PORT/" || echo 000)"
  [ "$code" = "200" ] || die "le portail ne repond pas depuis la machine (HTTP $code sur le port $HTTP_PORT)."
  info "Le portail repond depuis la machine (HTTP 200)."
elif timeout 5 bash -c "exec 3<>/dev/tcp/127.0.0.1/$HTTP_PORT" 2>/dev/null; then
  info "Le portail accepte les connexions sur le port $HTTP_PORT."
else
  die "le port $HTTP_PORT n'accepte aucune connexion alors que les services sont sains."
fi

# Seed du compte avocat de demonstration et d'une demande. Le script reste muet
# tant que le seed n'existe pas dans l'image (issues A2/B1) : il n'y a rien a
# faire pour l'utilisateur, donc rien a afficher.
if $DOCKER compose exec -T backend sh -c '[ -f dist/seed.js ]' 2>/dev/null; then
  step "Donnees de demonstration"
  $DOCKER compose exec -T backend node dist/seed.js
fi

cat <<BANNER

  ============================================================
   Le portail est demarre.

     Portail   http://127.0.0.1:$HTTP_PORT
     API       http://127.0.0.1:$HTTP_PORT/api

   Arreter :   docker compose down
   Journaux :  docker compose logs -f
  ============================================================

BANNER
