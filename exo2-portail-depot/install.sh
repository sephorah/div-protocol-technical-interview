#!/usr/bin/env bash
# Point d'entree du projet, prevu pour une machine vierge.
#
#   ./install.sh                monte toute la stack et affiche les URLs
#   ./install.sh --from-source  construit les images au lieu de les tirer
#
# HTTPS (A7) ne s'active PAS par un drapeau mais par `DOMAIN` dans .env : la
# configuration d'une machine appartient au fichier qui decrit cette machine,
# pas a un argument qu'il faudrait se rappeler a chaque redeploiement — et un
# oubli ferait retomber le portail en clair sans rien signaler. Vide, ce qui
# est le cas chez l'evaluateur, rien de tout cela ne se produit.
#
# Contrat : quand ce script rend la main sans erreur, l'application repond.
# Pas « les conteneurs sont lances » — le portail repond. Il n'y a aucune
# commande a taper ensuite, et rien a lire dans le README pour y arriver.
#
# Le developpement au quotidien, lui, n'utilise pas ce script : c'est
# `pnpm db:up && pnpm dev`, qui suppose Node et pnpm deja installes.
#
# Depuis A6, le cas nominal ne construit RIEN : les images sont tirees de GHCR,
# ou le workflow les publie. Ce script tourne donc aussi bien sur un checkout
# complet que sur la machine de staging, qui n'a que infra/, .env.example et ce
# fichier — d'ou l'absence deliberee de tout controle sur backend/ ou frontend/.
#
# pipefail : un pipe echoue si n'importe quel maillon echoue, pas seulement le dernier.
set -euo pipefail

cd "$(dirname "$0")"

HTTP_PORT=21600           # port attribue, cible du proxy de la machine
HTTPS_PORT=21601          # idem, cible du passthrough TLS (A7, si DOMAIN)
HEALTH_TIMEOUT=300        # secondes d'attente maximale des healthchecks
# minio-init en est deliberement ABSENT : la boucle d'attente plus bas n'accepte
# que healthy|running, or ce conteneur provisionne puis sort en 0. L'y ajouter
# ferait patienter le script jusqu'au HEALTH_TIMEOUT sur un conteneur qui a
# parfaitement fait son travail. L'attente sur backend le couvre deja, puisque
# le backend en depend (service_completed_successfully).
SERVICES="db minio backend frontend proxy"

# Toutes les commandes docker passent par $DOCKER : selon la machine, ce sera
# `docker` ou `sudo docker` (voir la cascade d'installation plus bas).
DOCKER="docker"

# Et toutes les commandes compose par `$DOCKER compose $COMPOSE`. Les deux
# drapeaux sont indissociables du deplacement des fichiers sous infra/ :
# compose deduit son repertoire de projet du dossier du premier `-f`, donc il
# chercherait infra/.env, qui n'existe pas — le .env vit a la racine, ou
# `pnpm dev` le lit aussi. Le `cd` ci-dessus rend ces deux chemins relatifs
# valides quel que soit le repertoire d'ou le script est appele.
COMPOSE="-f infra/docker-compose.yml --env-file .env"

# Calque de construction locale, ajoute a la SEULE commande `build` de
# --from-source. Tout le reste — pull, up, ps, logs, exec, la banniere — reste
# sur le compose de production seul : ce qui demarre est alors exactement le
# fichier qui tournera sur la machine de staging, images locales comprises
# (docker ne retelecharge pas ce qu'il a deja). Le fichier de base reste
# PREMIER, c'est lui qui fixe le repertoire de projet.
COMPOSE_BUILD="$COMPOSE -f infra/docker-compose.build.yml"

# Calque TLS (A7), ajoute plus bas si DOMAIN est renseigne. Le fichier de base
# reste PREMIER pour la meme raison que ci-dessus. Une fois le certificat
# obtenu, $COMPOSE devient $COMPOSE_TLS : tout ce qui suit — up, ps, logs, la
# banniere — parle alors de la pile reellement demarree.
# Ecrit en entier plutot que derive de $COMPOSE : le calque doit venir juste
# apres le fichier de base, et non apres `--env-file`, parce que cette chaine
# finit telle quelle dans la banniere et dans les messages d'erreur, ou un
# `-f` egare derriere l'option se recopie mal.
COMPOSE_TLS="-f infra/docker-compose.yml -f infra/docker-compose.tls.yml --env-file .env"

die() { printf '\nErreur : %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

usage() {
  echo "Usage : ./install.sh [--from-source]"
  echo "  (sans argument)  tire les images publiees, monte la stack, affiche les URLs"
  echo "  --from-source    construit les images en local au lieu de les tirer"
  echo "                   (necessite le code source ; sert a essayer le compose"
  echo "                    de production avant de publier)"
}

# Arguments valides en tete de script : sinon une faute de frappe se paie apres
# plusieurs minutes, et demarre la stack au lieu de s'arreter.
FROM_SOURCE=0
[ "$#" -le 1 ] || die "un seul argument est accepte (recu : $*)."
case "${1:-}" in
  '')            ;;
  --from-source) FROM_SOURCE=1 ;;
  -h|--help)     usage; exit 0 ;;
  *)             die "argument inconnu : $1 (attendu : --from-source, --help, ou aucun)." ;;
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

# Telechargement, curl ou wget selon ce que la machine a. Sortie sur stdout,
# pour rester pipeable vers `sh` comme les deux installeurs officiels
# l'attendent. Ecrit une fois ici plutot qu'en dur a chaque appel : sans ca,
# ajouter le repli wget demandait de modifier chaque site d'appel, et en
# oublier un se serait vu seulement sur une machine sans curl.
fetch_url() {
  if command -v curl >/dev/null; then
    curl -fsSL "$1"
  elif command -v wget >/dev/null; then
    wget -qO- "$1"
  else
    return 1
  fi
}

# Nom du gestionnaire de paquets de la machine, vide si aucun n'est reconnu.
detect_package_manager() {
  local pm
  for pm in apt-get dnf yum apk zypper pacman; do
    if command -v "$pm" >/dev/null; then
      printf '%s\n' "$pm"
      return 0
    fi
  done
  return 1
}

# Installe curl. $1 est le prefixe de privilege ("" ou "sudo").
#
# `apt-get update` avant l'installation est OBLIGATOIRE et c'est le piege de
# cette fonction : sur une ubuntu:24.04 nue, les listes de paquets sont vides et
# `apt-get install -y curl` repond « Unable to locate package curl » — un
# message qui accuse le paquet alors que c'est l'index qui manque.
#
# ca-certificates est demande explicitement : le premier usage de curl est un
# https:// vers get.docker.com. Sur Debian/Ubuntu il arrive en dependance, mais
# sur une image minimale son absence donne une erreur TLS qui n'evoque rien.
install_curl_with() {
  local sudo_cmd="$1" pm="$2"
  case "$pm" in
    apt-get) ${sudo_cmd} apt-get update -qq \
               && ${sudo_cmd} apt-get install -y -qq curl ca-certificates ;;
    dnf)     ${sudo_cmd} dnf install -y -q curl ca-certificates ;;
    yum)     ${sudo_cmd} yum install -y -q curl ca-certificates ;;
    apk)     ${sudo_cmd} apk add --no-cache curl ca-certificates ;;
    zypper)  ${sudo_cmd} zypper --non-interactive install curl ca-certificates ;;
    pacman)  ${sudo_cmd} pacman -Sy --noconfirm curl ca-certificates ;;
    *)       return 1 ;;
  esac
}

# Une marche de plus dans la cascade, et la meme philosophie qu'elle : on ne
# meurt qu'apres avoir epuise les options.
#
# Le script exigeait curl et mourait sinon en demandant `apt install curl`. Or
# ubuntu:24.04 n'a ni curl ni wget : le correcteur devait taper une commande,
# exactement ce que le contrat de ce script exclut. Les mesures « machine
# vierge » ne l'avaient jamais vu parce que le harnais de test installait curl
# AVANT de lancer le script — il validait donc une machine moins vierge que
# celle qu'il pretendait simuler.
ensure_fetcher() {
  # wget suffit : on n'installe pas curl par principe quand la machine a deja
  # de quoi telecharger.
  if command -v curl >/dev/null || command -v wget >/dev/null; then
    return 0
  fi

  info "Ni curl ni wget sur cette machine : installation de curl."

  local sudo_cmd=""
  if [ "$(id -u)" -ne 0 ]; then
    # `if` et non `&&` : sous set -e, un `a && b` qui renvoie 1 avorte le
    # script au lieu de laisser le die plus bas expliquer la situation.
    if can_sudo; then
      sudo_cmd="sudo"
    else
      die "curl est requis pour installer docker, et son installation demande
       les droits administrateur, dont ce compte ne dispose pas. Faites lancer :
         sudo apt-get install -y curl    (Debian/Ubuntu)
         sudo dnf install -y curl        (Fedora/RHEL)
         sudo apk add curl               (Alpine)"
    fi
  fi

  local pm=""
  if pm="$(detect_package_manager)"; then
    install_curl_with "$sudo_cmd" "$pm" || true
  fi

  command -v curl >/dev/null || die \
    "l'installation automatique de curl a echoue${pm:+ (gestionnaire : $pm)}.
       curl (ou wget) est indispensable pour telecharger docker. Installez-le :
         sudo apt-get update && sudo apt-get install -y curl   (Debian/Ubuntu)
         sudo dnf install -y curl                              (Fedora/RHEL)
         sudo apk add curl                                     (Alpine)"
  info "curl installe."
}

# `sudo -v` valide (et met en cache) les droits. Appele une seule fois, tot :
# l'eventuelle invite de mot de passe arrive avant les minutes de build, pas au
# milieu. `sudo -n` teste d'abord le cas sans mot de passe, pour ne rien
# demander quand ce n'est pas necessaire.
can_sudo() {
  command -v sudo >/dev/null || return 1
  sudo -n true 2>/dev/null && return 0
  [ -t 0 ] || return 1   # pas de terminal : impossible de saisir un mot de passe
  # Message volontairement general : cette fonction sert aussi bien a installer
  # curl (ensure_fetcher) qu'a installer docker, et un message qui ne parle que
  # de docker deviendrait faux dans le premier cas.
  info "Une installation systeme est necessaire, elle demande les droits administrateur."
  sudo -v
}

install_docker_privileged() {
  local sudo_cmd=""
  [ "$(id -u)" -eq 0 ] || sudo_cmd="sudo"
  info "Installation via le script officiel https://get.docker.com"
  fetch_url https://get.docker.com | ${sudo_cmd} sh
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
  info "  sudo usermod -aG docker ${USER:-$(id -un)}    (puis rouvrir la session)"
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
  fetch_url https://get.docker.com/rootless | sh || die \
    "l'installation de Docker rootless a echoue (prerequis manquants ci-dessus).
       Ces prerequis s'installent avec les droits administrateur. Le plus simple
       est alors de faire installer docker normalement :
         curl -fsSL https://get.docker.com | sudo sh
         sudo usermod -aG docker ${USER:-$(id -un)}    (puis rouvrir la session)"
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
  # Pas de garde macOS ici, deliberement : get.docker.com detecte Darwin lui-meme
  # et sort sur « ERROR: Unsupported operating system 'macOS' / Please get Docker
  # Desktop from ... ». Ajouter la notre remplacerait un message correct par un
  # autre, et nous ferait affirmer sur le reste du parcours macOS une chose que
  # nous n'avons pas verifiee, faute de Mac. macOS n'est pas un systeme couvert.

  # Obtenir de quoi telecharger AVANT d'essayer de telecharger. Cette marche
  # peut demander sudo : la mettre ici la fait passer par can_sudo, donc
  # l'eventuelle invite de mot de passe arrive une seule fois, au debut.
  ensure_fetcher
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
# Configuration
# --------------------------------------------------------------------------
# AVANT la verification du port, et l'ordre est load-bearing : `port_is_ours`
# appelle `docker compose ps`, qui ne peut pas parser un .env auquel manque une
# variable `${VAR:?}`. Un .env anterieur a l'ajout d'une variable requise faisait
# donc echouer la verification du port en annoncant un conflit inexistant — sur
# notre propre proxy. Cette etape ne depend que de .env.example, elle peut venir
# en premier.
#
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
# Verifie avant le build : sinon l'absence du fichier compose ne se signalerait
# qu'au premier appel a `docker compose`, apres l'etape de configuration, avec
# un message qui parle de chemins et pas du depot.
[ -f infra/docker-compose.yml ] || die "infra/docker-compose.yml est introuvable — le depot est incomplet."
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
# Deux paires distinctes, et c'est tout l'objet du decoupage : MINIO_ROOT_*
# administre le serveur (bucket, policy, utilisateur) et n'est passe qu'a minio
# et minio-init ; STORAGE_* est l'utilisateur applicatif restreint, le seul a
# atteindre le backend. Elles doivent differer, minio-init le verifie.
#
# Jamais regenerees si deja presentes (set_env_default) : un root regenere ne
# correspondrait plus a celui qui a cree l'utilisateur applicatif, et le
# provisionnement echouerait a l'authentification.
set_env_default STORAGE_ACCESS_KEY "$(random_hex 16)"
set_env_default STORAGE_SECRET_KEY "$(random_hex 32)"
set_env_default MINIO_ROOT_USER "$(random_hex 16)"
set_env_default MINIO_ROOT_PASSWORD "$(random_hex 32)"
# Compte avocat de demonstration. Le mot de passe est le seul des trois a etre
# genere : les deux autres sont des valeurs d'affichage, posees par
# .env.example. 12 octets, soit 24 caracteres hexadecimaux — assez court pour
# etre recopie a la main depuis la sortie du seed, assez long (~96 bits) pour
# qu'une attaque par force brute soit hors de question, ce qui est necessaire
# ici : le portail n'a pas de limitation de debit sur /auth/login (voir README).
#
# Comme les autres, genere UNE fois : le regenerer a chaque execution
# changerait le mot de passe imprime a l'evaluateur d'un `./install.sh` a
# l'autre, sans rien dire.
set_env_default SEED_LAWYER_PASSWORD "$(random_hex 12)"
set_env_default SEED_LAWYER_EMAIL avocat@example.com
set_env_default SEED_LAWYER_NAME "Maitre Dupont"

# chmod APRES les substitutions : set_env_value ecrit un fichier temporaire puis
# le deplace, ce qui reinitialiserait les permissions au umask.
chmod 600 .env

# --------------------------------------------------------------------------
# TLS (A7)
# --------------------------------------------------------------------------
# Lit une valeur de .env. Ces trois cles ne passent NI par docker compose NI par
# l'application : seul ce script les lit, pour les donner a certbot en ligne de
# commande. Elles n'ont donc pas d'entree `${VAR:?}` dans le compose, et ce
# n'est pas un oubli.
env_get() {
  # `cut` et non un decoupage sur `=` : un mot de passe ou un domaine ne
  # contiennent pas de `=`, mais rien ne le garantit pour une valeur future.
  # `tr -d '\r'` : un .env edite sous Windows glisserait un retour chariot dans
  # le nom de domaine, et certbot echouerait sur un message incomprehensible.
  grep -E "^$1=" .env 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d '\r'
}

DOMAIN="$(env_get DOMAIN)"
ACME_EMAIL="$(env_get ACME_EMAIL)"
ACME_STAGING="$(env_get ACME_STAGING)"

# DOMAIN est l'interrupteur : vide, la suite du script est celle d'avant A7.
if [ -n "$DOMAIN" ]; then
  TLS=1
  [ -n "$ACME_EMAIL" ] || die "DOMAIN est renseigne dans .env mais pas ACME_EMAIL.
       Let's Encrypt exige une adresse, et c'est le seul canal qui previendra
       si le renouvellement automatique cesse de fonctionner."
  step "HTTPS active pour $DOMAIN"
  if [ "$ACME_STAGING" = 1 ]; then
    info "Endpoint de TEST (ACME_STAGING=1) : le certificat obtenu ne sera"
    info "reconnu par aucun navigateur. C'est le brouillon — la production"
    info "plafonne a 5 certificats identiques par semaine."
  else
    info "Endpoint de production. Si c'est un premier essai sur ce domaine,"
    info "passez d'abord par ACME_STAGING=1."
  fi
else
  TLS=0
fi

# --------------------------------------------------------------------------
# Port
# --------------------------------------------------------------------------
# Teste AVANT le pull : sinon l'echec arrive apres le telechargement (ou, en
# --from-source, apres plusieurs minutes de build). Un port
# tenu par notre propre proxy n'est pas un conflit — compose recree le
# conteneur — sinon un second ./install.sh echouerait sur lui-meme.
# Prend le port en argument, et verifie que notre proxy publie CE port-la : se
# contenter de « le proxy tourne » declarerait libre un 21601 tenu par un
# programme tiers pendant que notre proxy n'ecoute qu'en 21600, et l'echec
# n'arriverait qu'au `up`, sans nommer le vrai coupable.
port_is_ours() {
  local ids; ids="$($DOCKER compose $COMPOSE ps -q proxy 2>/dev/null || true)"
  [ -n "$ids" ] || return 1
  $DOCKER inspect --format '{{json .NetworkSettings.Ports}}' $ids 2>/dev/null \
    | grep -q "\"HostPort\":\"$1\""
}

# Tente une connexion TCP sur 127.0.0.1:$1, avec un garde-temps de $2 secondes.
# Retourne 0 si quelque chose ecoute.
#
# `timeout` vient des coreutils GNU et N'EXISTE PAS sur macOS. Ecrit en dur, la
# commande absente renvoyait 127, le `if` echouait, et port_state concluait
# « port libre » — un port reellement occupe passait la verification et l'echec
# n'arrivait qu'au `up`, sans nommer le coupable. Exactement la panne silencieuse
# que le commentaire de port_state dit vouloir eviter.
#
# Sans garde-temps le risque est nul ici : sur la boucle locale, une connexion
# aboutit ou est refusee immediatement, il n'y a personne pour laisser pendre.
tcp_probe() {
  if command -v timeout >/dev/null; then
    timeout "$2" bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" 2>/dev/null
  else
    bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" 2>/dev/null
  fi
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
  if tcp_probe "$1" 2; then
    return 1
  fi
  return 0
}

check_port() {
  # `port_state ...; status=$?` ne convient pas : sous `set -e`, une commande
  # simple qui renvoie non-zero interrompt le script avant l'affectation, et
  # l'echec devient muet. Le `||` protege l'appel.
  local port="$1" port_status=0
  port_state "$port" || port_status=$?
  if [ "$port_status" -eq 0 ] || port_is_ours "$port"; then
    info "Port $port : disponible."
  else
    info "Port $port, occupe par :"
    (command -v ss >/dev/null && ss -ltnp "sport = :$port" 2>/dev/null | tail -n +2) || true
    die "le port $port est deja utilise par un autre programme.
       C'est un port attribue a ce projet (plage 21600-21699) : liberez-le, ou
       arretez la pile qui l'occupe."
  fi
}

step "Verification des ports"
check_port "$HTTP_PORT"
# 21601 seulement en TLS : sans lui, rien ne le publie et un autre programme a
# parfaitement le droit de l'occuper.
if [ "$TLS" = 1 ]; then
  check_port "$HTTPS_PORT"
fi

# --------------------------------------------------------------------------
# Images et demarrage
# --------------------------------------------------------------------------
if [ "$FROM_SOURCE" = 1 ]; then
  # Un checkout de production n'a ni le calque ni les sources. Sans ce controle,
  # docker se plaindrait d'un fichier compose introuvable, ce qui ne dit pas
  # que c'est le drapeau qui n'a pas sa place ici.
  [ -f infra/docker-compose.build.yml ] && [ -d backend ] && [ -d frontend ] || die \
    "--from-source demande le code source, absent de ce checkout. C'est le cas
       sur la machine de production, qui ne recoit que infra/ et .env : lancez
       ./install.sh sans argument, les images sont publiees."
  step "Construction des images depuis les sources"
  info "Elles sont taguees sous leur nom GHCR : le demarrage qui suit n'utilise"
  info "que le compose de production, et les retrouve en local sans aller au"
  info "registre. Comptez quelques minutes."
  $DOCKER compose $COMPOSE_BUILD build
else
  # Le pull est une etape a part, et non un effet de bord de `up`, pour deux
  # raisons : son echec doit etre explique (un `up` dirait « manifest unknown »
  # et rien d'autre), et il doit arriver avant que quoi que ce soit demarre.
  step "Recuperation des images"
  info "Portail depuis ghcr.io, base et stockage depuis docker hub."
  # Avec le calque en TLS : certbot est une image de plus a tirer, et la tirer
  # maintenant evite une attente au milieu de l'obtention du certificat.
  # `pull` ne demarre rien, le calque est donc sans effet sur la suite.
  pull_compose="$COMPOSE"
  if [ "$TLS" = 1 ]; then
    pull_compose="$COMPOSE_TLS"
  fi
  $DOCKER compose $pull_compose pull || die \
    "impossible de recuperer les images. Le message de docker ci-dessus dit
       laquelle ; pour celles du portail (ghcr.io), les causes sont :
         - les paquets GHCR sont restes prives — un pull anonyme repond alors
           403, ce qui ressemble a une image inexistante ;
         - la version demandee n'existe pas : IMAGE_TAG vaut « ${IMAGE_TAG:-le defaut ecrit dans le compose} » ;
         - la machine ne joint pas le registre.
       Ce script ne construit pas a la place : la machine de production n'a pas
       le code source. Depuis un checkout complet, ./install.sh --from-source."
fi

# --------------------------------------------------------------------------
# Certificat (A7)
# --------------------------------------------------------------------------
# AVANT le demarrage, et l'ordre est load-bearing : si le certificat est deja
# la — le cas de tout redeploiement — on demarre DIRECTEMENT avec le calque.
# Passer systematiquement par la pile en clair recreerait le proxy deux fois et
# supprimerait le 443 entre les deux, donc une coupure HTTPS a chaque relance.
# La pile en clair n'est qu'un moyen d'AMORCAGE : nginx refuse de demarrer si
# ssl_certificate designe un fichier absent, donc le tout premier certificat ne
# peut etre obtenu qu'a travers elle.
NEED_ISSUE=0
if [ "$TLS" = 1 ]; then
  # `run --rm` : un conteneur jetable qui sort. Le service `certbot` du calque,
  # lui, est une boucle de RENOUVELLEMENT — il n'emet jamais, sans quoi un
  # echec le ferait boucler sur `certonly` et griller les quotas.
  certbot_run() {
    $DOCKER compose $COMPOSE_TLS run --rm --entrypoint certbot certbot "$@"
  }

  # La lignee porte un nom fixe, `portail`, et non le domaine : c'est ce qui
  # permet a nginx-tls.conf de ne jamais nommer le domaine (il ne lit pas
  # l'environnement). Voir l'en-tete de ce fichier de conf.
  cert_exists() {
    certbot_run certificates --cert-name portail 2>/dev/null \
      | grep -q 'Certificate Name: portail'
  }

  # certbot ecrit lui-meme le serveur ACME utilise dans le fichier de
  # renouvellement : source plus fiable qu'un marqueur qu'on poserait de notre
  # cote et qui pourrait desynchroniser.
  cert_is_staging() {
    $DOCKER compose $COMPOSE_TLS run --rm --entrypoint sh certbot -c \
      'grep -q acme-staging /etc/letsencrypt/renewal/portail.conf 2>/dev/null'
  }

  issue_certificate() {
    local staging_flag=""
    if [ "$ACME_STAGING" = 1 ]; then
      staging_flag="--test-cert"
    fi
    # --webroot : certbot depose le jeton dans le volume, c'est nginx — deja en
    # marche — qui le sert. Aucune coupure, contrairement a --standalone qui
    # voudrait le port 80 pour lui seul.
    certbot_run certonly --webroot -w /var/www/certbot \
      --cert-name portail -d "$DOMAIN" \
      --email "$ACME_EMAIL" --agree-tos --no-eff-email --non-interactive \
      $staging_flag \
      || die "l'obtention du certificat a echoue. Les causes habituelles :
         - $DOMAIN ne resout pas vers cette machine, ou son port 80 n'est pas
           relaye jusqu'a 127.0.0.1:$HTTP_PORT ;
         - un quota Let's Encrypt est atteint (5 certificats identiques par
           semaine) — repassez par ACME_STAGING=1 ;
         - le jeton n'est pas servi : verifier que
           http://$DOMAIN/.well-known/acme-challenge/ ne repond pas 502.
       La pile reste en clair sur le port $HTTP_PORT, elle n'est pas cassee."
  }

  step "Certificat TLS"
  if cert_exists; then
    if [ "$ACME_STAGING" != 1 ] && cert_is_staging; then
      # Le piege classique : un certificat de test laisse en place fait echouer
      # tous les navigateurs, avec un message qui n'evoque rien de tel.
      info "Certificat de TEST en place et ACME_STAGING n'est plus a 1 :"
      info "suppression, puis emission du vrai certificat."
      certbot_run delete --cert-name portail --non-interactive
      NEED_ISSUE=1
    else
      info "Certificat deja present : demarrage direct en HTTPS. Son"
      info "renouvellement est le travail du conteneur certbot, pas de ce script."
    fi
  else
    info "Aucun certificat pour ce portail : il sera demande a Let's Encrypt"
    info "une fois la pile en clair demarree (elle seule peut servir le jeton)."
    NEED_ISSUE=1
  fi

  # Rien a emettre : le calque est monte des le premier demarrage.
  if [ "$NEED_ISSUE" = 0 ]; then
    COMPOSE="$COMPOSE_TLS"
    # certbot n'a pas de healthcheck : la boucle d'attente se contente de
    # `running`, ce qui prouve que le conteneur de renouvellement tourne.
    SERVICES="$SERVICES certbot"
  fi
fi

step "Demarrage de la stack"
$DOCKER compose $COMPOSE up -d

# --------------------------------------------------------------------------
# Attente
# --------------------------------------------------------------------------
# C'est cette etape qui fait la difference entre « le script a rendu la main »
# et « l'application repond ». Les migrations sont jouees par l'entrypoint du
# backend : un backend healthy signifie qu'elles sont passees.
health_of() {
  local id; id="$($DOCKER compose $COMPOSE ps -q "$1" 2>/dev/null || true)"
  [ -n "$id" ] || { echo "absent"; return; }
  $DOCKER inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo absent
}

# Fonction et non code en ligne : en TLS, la pile est redemarree avec le calque
# apres l'obtention du certificat, et il faut la reattendre.
wait_for_services() {
  local waited=0 pending service
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
      $DOCKER compose $COMPOSE ps
      for service in $pending; do
        printf '\n--- %s ---\n' "$service"
        $DOCKER compose $COMPOSE logs --tail=50 "$service"
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
}

step "Attente des services (migrations comprises)"
wait_for_services

# Les healthchecks sondent depuis l'interieur des conteneurs. Ils prouvent que
# nginx sert, pas que la publication du port fonctionne depuis la machine —
# or c'est cela, le contrat. Verification cote hote, en bash pur : si curl est
# la on va jusqu'au code HTTP, sinon on se contente d'ouvrir la connexion.
check_portal_http() {
  if command -v curl >/dev/null; then
    local code
    # Pas de `|| echo 000` : curl a DEJA ecrit son code (000 quand il n'a pas
    # abouti) avant de sortir en erreur, et le repli s'y concatenait — le
    # message annoncait « HTTP 000000 ».
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$HTTP_PORT/" || true)"
    [ "${code:-000}" = "200" ] || die "le portail ne repond pas depuis la machine (HTTP ${code:-000} sur le port $HTTP_PORT)."
    info "Le portail repond depuis la machine (HTTP 200)."
  elif tcp_probe "$HTTP_PORT" 5; then
    info "Le portail accepte les connexions sur le port $HTTP_PORT."
  else
    die "le port $HTTP_PORT n'accepte aucune connexion alors que les services sont sains."
  fi
}

# La verification qui distingue « nginx ecoute en 443 » de « le HTTPS marche » :
# --resolve fabrique la bonne indication de nom (SNI) sans dependre du DNS ni du
# proxy de la machine, et curl echoue si le certificat ne vaut rien.
check_portal_https() {
  if command -v curl >/dev/null; then
    local insecure="" code
    if [ "$ACME_STAGING" = 1 ]; then
      # Attendu : aucune autorite ne reconnait l'endpoint de test. On verifie
      # alors le reste de la chaine, pas la confiance.
      insecure="-k"
    fi
    code="$(curl -s $insecure -o /dev/null -w '%{http_code}' --max-time 10 \
      --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "https://$DOMAIN:$HTTPS_PORT/" || true)"
    # `000` signifie que la connexion n'a pas abouti, et la cause la plus
    # frequente est un certificat que curl refuse — donc bien plus souvent le
    # certificat que nginx.
    [ "${code:-000}" = "200" ] || die "le portail ne repond pas en HTTPS (code ${code:-000} sur le port $HTTPS_PORT).
       Un code 000 vient le plus souvent du certificat lui-meme :
         curl -v --resolve $DOMAIN:$HTTPS_PORT:127.0.0.1 https://$DOMAIN:$HTTPS_PORT/
       Journaux du proxy :
         docker compose $COMPOSE logs proxy"
    info "HTTPS repond depuis la machine (200)."
  elif tcp_probe "$HTTPS_PORT" 5; then
    # Sans curl on ne peut pas valider la terminaison TLS, seulement l'ecoute.
    info "Le port $HTTPS_PORT accepte les connexions (curl absent : TLS non verifie)."
  else
    die "le port $HTTPS_PORT n'accepte aucune connexion alors que les services sont sains."
  fi
}

# En demarrage direct HTTPS, le 21600 ne repond plus 200 mais 301 : c'est le
# 21601 qui porte le contrat.
if [ "$TLS" = 1 ] && [ "$NEED_ISSUE" = 0 ]; then
  check_portal_https
else
  check_portal_http
fi

# --------------------------------------------------------------------------
# Amorcage du certificat, puis bascule en HTTPS (A7)
# --------------------------------------------------------------------------
# Ce bloc n'existe QUE pour le premier certificat, ou pour le passage du
# certificat de test au vrai. Un redeploiement ordinaire est deja parti en
# HTTPS plus haut et ne passe pas ici — sans quoi chaque relance couperait le
# 443 le temps de deux recreations du proxy.
#
# On arrive ici avec la pile en clair, saine : c'est elle qui sert le jeton que
# Let's Encrypt vient lire sur le port 80 de la machine, relaye sur 21600.
if [ "$TLS" = 1 ] && [ "$NEED_ISSUE" = 1 ]; then
  step "Obtention du certificat"
  issue_certificate

  # A partir d'ici, TOUT parle de la pile avec le calque : up, ps, logs, exec,
  # et la banniere finale (le heredoc est interpole).
  COMPOSE="$COMPOSE_TLS"
  SERVICES="$SERVICES certbot"

  step "Redemarrage en HTTPS"
  $DOCKER compose $COMPOSE up -d
  wait_for_services
  check_portal_https
fi

# Seed du compte avocat de demonstration et d'une demande. Le script reste muet
# tant que le seed n'existe pas dans l'image (issues A2/B1) : il n'y a rien a
# faire pour l'utilisateur, donc rien a afficher.
if $DOCKER compose $COMPOSE exec -T backend sh -c '[ -f dist/seed.js ]' 2>/dev/null; then
  step "Donnees de demonstration"
  $DOCKER compose $COMPOSE exec -T backend node dist/seed.js
fi

# En TLS, l'URL utile est publique : le 127.0.0.1:21600 y repond encore, mais
# par un 301 vers elle.
if [ "$TLS" = 1 ]; then
  URLS="   Portail   https://$DOMAIN
     API       https://$DOMAIN/api
     (le port $HTTP_PORT redirige desormais vers HTTPS)"
  # Surtout pas de renvoi vers `pnpm stack:down` ici : ces scripts ne portent
  # que le compose de base, donc ils laisseraient certbot en marche et
  # remonteraient le proxy en clair. Les commandes ci-dessus sont completes.
  HINT="   (depuis la racine du depot)"
else
  URLS="   Portail   http://127.0.0.1:$HTTP_PORT
     API       http://127.0.0.1:$HTTP_PORT/api"
  # Le port est lie a la boucle locale EXPRES (machine partagee), donc en
  # session SSH cette adresse designe le poste de l'utilisateur et non le
  # serveur. On ne peut pas afficher l'IP de la machine a la place : rien
  # n'y ecoute, ce serait une URL morte. On explique, et on donne le tunnel.
  if [ -n "${SSH_CONNECTION:-}" ]; then
    URLS="$URLS

     Session SSH detectee : ce port n'ecoute que sur la boucle locale
     de CETTE machine. Depuis votre poste :
       ssh -L $HTTP_PORT:127.0.0.1:$HTTP_PORT ${USER:-<utilisateur>}@<hote>
     puis ouvrez http://127.0.0.1:$HTTP_PORT"
  fi
  HINT="   (depuis la racine du depot ; ou pnpm stack:down / pnpm stack:logs)"
fi

cat <<BANNER

  ============================================================
   Le portail est demarre.

  $URLS

   Arreter :   docker compose $COMPOSE down
   Journaux :  docker compose $COMPOSE logs -f

$HINT
  ============================================================

BANNER
