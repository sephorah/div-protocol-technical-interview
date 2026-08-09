# A7 — HTTPS Let's Encrypt avec renouvellement automatique

Date : 2026-08-08 · Branche : `feat/a7-https-lets-encrypt` · Dépendance : A6

## Le problème

L'énoncé décrit le routage de la machine partagée :

> port 80 (HTTP) → `127.0.0.1:21600`, port 443 (HTTPS) → `127.0.0.1:21601`, **en passthrough TLS**.
> Le challenge http-01 arrive sur le port 80 de la machine et t'est relayé. Comme le 443 est en
> passthrough, **c'est bien ton nginx qui termine TLS** avec ton certificat.

Le proxy frontal distingue les candidats par le `Host` en clair et par le **SNI** en HTTPS, où il ne
déchiffre rien : il lit le nom dans le `ClientHello` et recopie les octets. Certificat, clé privée et
négociation TLS sont donc entièrement à notre charge. Avant A7, nginx n'écoutait que sur `:80` :
l'URL HTTPS du sous-domaine ne répondait pas du tout.

Trois obligations en découlent : écouter aussi sur `127.0.0.1:21601` en TLS, publier le jeton du
challenge HTTP-01 sur `/.well-known/acme-challenge/`, et **automatiser** le renouvellement — un
certificat Let's Encrypt vit 90 jours.

## Comparatif

| Option | Pour | Contre | Retenu |
|---|---|---|---|
| **certbot + nginx en `--webroot`** | aucun changement de proxy, aucune coupure, mécanisme explicite et lisible | deux conteneurs à coordonner, rechargement périodique | **oui** |
| Caddy à la place de nginx | ACME automatique, ~10 lignes de conf | réécrit un reverse proxy déjà documenté et éprouvé (règle `deny all`, tailles de corps, fallback SPA), et change de techno pour un seul besoin | non |
| `certbot --standalone` | pas de conf nginx à toucher | veut le port 80 pour lui seul : il est pris par nginx, donc coupure à chaque renouvellement | non |
| `nginx-proxy/acme-companion` | tout automatique | exige le **socket docker**, c'est-à-dire un accès root déguisé, sur une machine partagée avec d'autres candidats | non |
| `acme.sh`, `lego` | équivalents fonctionnels | aucun avantage ici, et moins de documentation que certbot | non |

**Renouvellement** : sidecar en boucle dans le compose plutôt que cron ou timer systemd sur la
machine. Tout reste versionné dans le dépôt et survit au reboot par `restart: unless-stopped`, là où
un cron laisserait sur la machine un état que rien ne décrit — et `systemd --user` peut être absent.

**Activation** : `DOMAIN` dans `.env` plutôt qu'un drapeau `--tls`. La configuration d'une machine
appartient au fichier qui décrit cette machine ; un drapeau devrait être retapé à chaque
redéploiement et l'oublier une fois ferait retomber le portail en clair sans rien signaler. C'est un
arbitrage explicite : on perd la possibilité de forcer HTTP ponctuellement sur une machine
configurée en TLS, ce dont personne n'a besoin.

## Ce qui a été fait

**nginx en trois fichiers.** `portal-locations.conf` contient les `location` du portail et est
`include` par les deux serveurs ; `nginx.conf` est la variante en clair, `nginx-tls.conf` la variante
TLS. Le calque monte la seconde **par-dessus** `/etc/nginx/conf.d/default.conf` — compose fusionne
les `volumes` **par chemin cible**, les deux confs ne sont donc jamais chargées ensemble.
L'extraction n'est pas cosmétique : dupliquée, la règle `deny all` de la sonde de santé aurait fini
par n'exister que d'un côté, rendant la sonde publique en HTTPS sans que rien ne le signale. Le
fragment est monté **hors de `conf.d/`**, que la conf principale charge au niveau `http`, où un
`location` nu est une erreur de syntaxe.

**`infra/docker-compose.tls.yml`** ajoute `127.0.0.1:21601:443`, les montages TLS, une boucle de
rechargement nginx (6 h) et un service `certbot` en boucle de renouvellement (12 h).

**`install.sh`** lit `DOMAIN` : vide, rien ne change ; renseigné, il vérifie aussi le port 21601,
monte la pile en clair, obtient le certificat au travers d'elle, redémarre avec le calque et vérifie
le résultat par `curl --resolve`.

### Cinq points non devinables

1. **L'amorçage passe par la pile en clair.** nginx **refuse de démarrer** si `ssl_certificate`
   désigne un fichier absent : on ne peut donc pas démarrer en TLS pour obtenir le certificat qui
   permettrait de démarrer en TLS. D'où le volume `certbot_www` déclaré aussi dans le compose de
   base, et le `location` ACME présent dans les **deux** confs — dans la conf TLS il précède la
   redirection 301, sans quoi les *renouvellements* échoueraient, Let's Encrypt sondant toujours en
   clair. En nginx, c'est le préfixe le plus spécifique qui l'emporte, pas l'ordre d'écriture ; et
   la redirection est un `return` dans un `location /`, pas dans le `server`, où elle s'appliquerait
   aussi au challenge.
2. **La lignée s'appelle `portail`, pas le domaine.** C'est ce qui permet à `nginx-tls.conf` de ne
   nommer le domaine nulle part, donc à `DOMAIN` de rester une source de vérité unique. Nécessaire :
   nginx ne lit pas l'environnement, et le mécanisme de templates de l'image officielle est
   hors-jeu — ses scripts `/docker-entrypoint.d/` ne s'exécutent que si la commande à lancer est
   `nginx`, or le calque la remplace par un `sh -c` pour la boucle de rechargement.
3. **Le rechargement est périodique.** `--deploy-hook` ne peut pas signaler nginx depuis le
   conteneur certbot sans monter le socket docker — un accès root déguisé, refusé sur une machine
   partagée.
4. **Le certbot du calque ne fait que renouveler.** L'émission est un `run --rm` de `install.sh` :
   une boucle qui émettrait aussi retenterait `certonly` indéfiniment en cas d'échec et grillerait
   le quota de production (5 certificats identiques par semaine) en quelques heures.
5. **Pas d'agrafage OCSP.** Let's Encrypt a retiré les URL OCSP de ses certificats le 7 mai 2025 et
   éteint ses répondeurs le 6 août 2025 : `ssl_stapling on` n'écrirait plus que des avertissements.
   Le profil Mozilla *intermediate* est repris sans ses suites DHE, qui exigeraient un `ssl_dhparam`
   que nginx ne fournit plus par défaut depuis la 1.11 et dont aucun client n'a besoin ici.

## Vérification

**En local, sans domaine** — la pile en clair d'abord, c'est le chemin de l'évaluateur et il ne doit
pas bouger :

| Test | Attendu | Obtenu |
|---|---|---|
| `./install.sh`, `DOMAIN` vide | 200 sur `127.0.0.1:21600`, pas de 21601, pas de certbot | conforme, **13,8 s** |
| `/api/v1/health` en clair | 403 | 403 |
| `/.well-known/acme-challenge/test` | 404 (le `location` vit, sa racine existe) | 404 |

Puis le calque, avec un **certificat auto-signé jetable** déposé dans le volume : cela éprouve tout
sauf Let's Encrypt lui-même — la conf TLS, la fusion des montages, la boucle de rechargement, la
sonde HTTPS, la publication du port.

| Test | Attendu | Obtenu |
|---|---|---|
| `21600/` | 301 vers HTTPS | 301 |
| `21600/.well-known/acme-challenge/test` | 404, **pas** 301 | 404 |
| `21601/` en SNI | 200, HTTP/2 | 200, `proto=2` |
| en-tête HSTS | `max-age=15552000` | conforme |
| `21601/api/v1/health` | 403 — la sonde reste privée en HTTPS aussi | 403 |
| PID 1 du proxy | `nginx` (le `exec` a bien remplacé le shell) | `nginx`, boucle vivante |
| `docker compose stop proxy certbot` | rapide, le `trap` rend le sleep interruptible | **0,94 s** |
| `nginx -s reload` puis requête | 200 | 200 |

Enfin, une **lignée certbot complète** fabriquée à la main dans le volume (archive + liens
symboliques `live/` + `renewal/portail.conf`), pour éprouver les branches que le certificat
auto-signé seul n'atteint pas :

| Test | Attendu | Obtenu |
|---|---|---|
| `certbot certificates --cert-name portail` | la lignée est reconnue | `Certificate Name: portail` |
| `install.sh`, certificat présent | **démarrage direct en HTTPS**, aucun appel à Let's Encrypt | conforme, **12,1 s** |
| la même, `ACME_STAGING=1` | 200 en HTTPS, bannière en URL publique | conforme |
| `cert_is_staging` sur `acme-staging-v02` | vrai | vrai |
| la même sur `acme-v02` | faux | faux |
| `cert_exists` sur une lignée absente | faux | faux |
| vérification stricte sans `-k` | échec — le certificat auto-signé n'est pas reconnu | `curl` sort en 60 |

Certificat jetable et volume supprimés, pile en clair restaurée après les essais.

## Revue de code

Le diff a été relu en entier. Quatre défauts trouvés et corrigés :

1. **Chaque relance aurait coupé HTTPS.** La première version montait systématiquement la pile en
   clair avant de basculer : le proxy était donc recréé deux fois à chaque redéploiement, sans le
   443 entre les deux. Corrigé — le certificat est examiné **avant** le démarrage, et s'il existe le
   calque est monté d'emblée. La pile en clair n'est plus qu'un moyen d'amorçage. Mesuré : 12,1 s
   pour un redéploiement, un seul démarrage.
2. **`port_is_ours` ignorait le port.** Il répondait « c'est notre proxy » dès que le proxy
   existait ; un programme tiers sur 21601 aurait donc été déclaré libre alors que notre proxy
   n'écoutait qu'en 21600, et l'échec serait tombé au `up` sans nommer le coupable. Il prend
   désormais le port en argument et inspecte les ports réellement publiés.
3. **`curl ... || echo 000` produisait « HTTP 000000 »** : curl écrit déjà `000` via `-w` avant de
   sortir en erreur, et le repli s'y concaténait. Vu en conditions réelles pendant les essais.
4. **La bannière renvoyait vers `pnpm stack:down` en mode TLS**, alors que ces scripts ne portent
   que le compose de base : ils auraient laissé certbot en marche et remonté le proxy en clair.

Un cinquième point est cosmétique : `COMPOSE_TLS` est écrit en entier au lieu d'être dérivé de
`$COMPOSE`, pour que le `-f` du calque ne se retrouve pas derrière `--env-file` dans la bannière.

**Sur la machine de staging**, déploiement effectué (premier déploiement réel du projet, ce qui
valide A6 du même coup) : `git sparse-checkout`, `./install.sh` en HTTP, puis `ACME_STAGING=1`, puis
le certificat réel. Contrôlé depuis internet, hors de la machine :

| Test | Attendu | Obtenu |
|---|---|---|
| `https://<domaine>/` | 200 | 200, HTTP/2 |
| `http://<domaine>/` | 301 vers HTTPS | 301 |
| émetteur du certificat | Let's Encrypt, **pas** `(STAGING)` | `O=Let's Encrypt, CN=YE2` |
| validité | 90 jours | 9 août → 7 novembre 2026 |
| confiance | `curl` accepte sans `-k` | accepté |
| `/api/v1/health` | 403 — c'est notre conf qui tourne | 403 |
| `/api/` | 404 du backend, et non l'index du frontend | 404 |
| HSTS | présent | `max-age=15552000` |
| ports 21600, 21601, 21610, 21632, 21690, 21691 depuis internet | tous refusés | tous refusés |

Le dernier contrôle vaut les autres : la machine est partagée, et un seul port publié sur `0.0.0.0`
aurait exposé la base par `/api` et la console MinIO, c'est-à-dire toutes les pièces des clients.

**Renouvellement** : `certbot renew --dry-run` sur la machine répond « Congratulations, all
simulated renewals succeeded ». La commande rejoue tout le protocole contre l'endpoint de test sans
toucher au certificat réel — c'est le seul moyen de savoir aujourd'hui que le renouvellement
fonctionnera dans deux mois, plutôt que de le découvrir le jour où le portail cesserait de répondre.

Les cinq critères d'acceptation de l'issue sont donc satisfaits.

## Sécurité

Traité : la clé privée ne vit que dans un volume docker, monté `:ro` côté nginx ; `21601` est publié
**sur `127.0.0.1` explicitement**, comme `21600` — un `21601:443` nu exposerait le portail à toute
la machine partagée ; TLS 1.2 minimum, profil Mozilla *intermediate* ; redirection 301 systématique ;
HSTS borné à 180 jours, **sans** `includeSubDomains` ni `preload`, le domaine parent appartenant à
quelqu'un d'autre ; certbot ne reçoit pas le socket docker ; la sonde de santé reste `deny all` des
deux côtés.

Résiduel :

- **`$remote_addr` n'est pas l'adresse du client.** En passthrough SNI, la connexion TCP vient du
  proxy de la machine ; sans PROXY protocol, nginx ne voit que lui, et le `X-Forwarded-For` que nous
  produisons est faux. **Conséquence directe sur G1** : une limitation de débit par IP est
  inopérante, il faudra limiter par jeton de lien. C'est la découverte la plus lourde de cette
  issue, et elle touche la protection du PIN à 4 chiffres.
- **HSTS engage 180 jours** : un retour en HTTP bloquerait les navigateurs déjà venus.
- **Le certificat expire en 90 jours** ; machine éteinte plus longtemps, rien ne rattrape avant le
  réveil.
- **Le portail est en HTTP entre le proxy de la machine et nous** pour le trafic `:80` — c'est
  imposé par le relais, et c'est précisément ce que la redirection 301 minimise.

## Sources

- [Let's Encrypt — Challenge types](https://letsencrypt.org/docs/challenge-types/)
- [Let's Encrypt — Rate limits](https://letsencrypt.org/docs/rate-limits/)
- [Let's Encrypt — Ending OCSP support](https://letsencrypt.org/2024/12/05/ending-ocsp) et
  [fin de vie du service](https://letsencrypt.org/2025/08/06/ocsp-service-has-reached-end-of-life)
- [Certbot — user guide](https://eff-certbot.readthedocs.io/en/stable/using.html)
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)
- [Compose file merge — fusion des `volumes` par chemin cible](https://docs.docker.com/reference/compose-file/merge/)
- [Guide to Automatic SSL Certificate Renewal for Nginx and Docker](https://dev.to/merbayerp/guide-to-automatic-ssl-certificate-renewal-for-nginx-and-docker-fic)
