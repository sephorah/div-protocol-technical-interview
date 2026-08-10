# Tests manuels

Ce que le produit doit démontrer, dérivé de l'énoncé. Deux parties : les critères **obligatoires**
(éliminatoires), puis les **attendus** (différenciateurs). Chaque ligne est une action et son
résultat attendu — pas une intention.

Les bonus de l'énoncé (antivirus, URLs pré-signées, journal d'audit, CI, limitation de débit sur le
PIN) ne figurent pas ici : leur absence ne retire rien. Ce qui manque est dit dans
`README.md § Limites connues`.

**Pile lancée :** `./install.sh`, puis http://127.0.0.1:21600
Le script imprime en fin de course les identifiants de démonstration, le lien client et son PIN.
Les commandes ci-dessous se lancent **depuis la racine du dépôt**.

**Piège qui invalide la moitié des cases s'il est ignoré :** ouvrir le lien client dans une
**fenêtre de navigation privée**, jamais dans un autre onglet de la même fenêtre. Un onglet ordinaire
emporte le cookie de session de l'avocat, et l'écran client testé n'est alors plus le parcours
anonyme que l'énoncé décrit.

---

## A. Critères obligatoires

### A1. `./install.sh` en one-click, sur machine nue

- [ ] `./scripts/test-bare-machine.sh` → **exit 0**, et la sortie imprime la durée
- [ ] La même commande affiche `/` → **200**, `/api/v1/health` → **403**, `/api/v1/metrics` → **403**
- [ ] `ls -l .env` → **`-rw-------`** (600)
- [ ] Le jeton de dépôt n'apparaît **nulle part** dans `docker compose … logs proxy` ni
      `… logs frontend` : la vérification est **négative**, chercher `[redacted]` ne prouve rien
      puisque la panne consiste à écrire une ligne *en plus*
- [ ] Relancer `./install.sh` sur une pile déjà démarrée → exit 0 en quelques secondes, aucun
      secret régénéré (comparer `DB_PASSWORD` dans `.env` avant/après)

### A2. Backend NestJS

- [ ] `docker compose -f infra/docker-compose.yml --env-file .env exec backend node -e "fetch('http://127.0.0.1:21610/api/v1/health').then(r=>r.text()).then(console.log)"`
      → `{"status":"ok","db":"up","storage":"up"}`
- [ ] `docker compose -f infra/docker-compose.yml --env-file .env stop db`, refaire la sonde →
      **503** et `"db":"down"` ; `start db` pour revenir

### A3. Frontend Chakra UI v3

- [ ] http://127.0.0.1:21600/login s'affiche avec la charte DIV (violet `#7B2CFF`, Inter), pas le
      thème Chakra par défaut
- [ ] Onglet *Réseau* du navigateur : **aucune requête hors origine** (la police est auto-hébergée,
      pas Google Fonts)

### A4. Auth avocat, client anonyme

- [ ] Se connecter avec le compte imprimé par `install.sh` → arrivée sur `/dashboard`
- [ ] `curl -i http://127.0.0.1:21600/api/v1/requests` (sans cookie) → **401**
- [ ] Cookie de session : `HttpOnly`, `SameSite=Lax`, et **pas** `Secure` en HTTP local
      (un cookie `Secure` sur `127.0.0.1` serait posé puis jamais renvoyé, et la connexion
      échouerait en silence)
- [ ] En navigation privée, le lien client donne accès au dépôt **sans aucun compte**

### A5. Stockage objet MinIO conteneurisé

- [ ] `docker compose -f infra/docker-compose.yml --env-file .env ps` → le service `minio` est
      *healthy*, et `minio-init` est *exited (0)*
- [ ] `docker compose … exec backend node -e "…"` sur `/api/v1/health` → `"storage":"up"`
- [ ] **Aucun port MinIO publié** en production : `docker compose … ps` ne montre `0.0.0.0`/
      `127.0.0.1` sur aucun port de `minio`

### A6. Image publiée sur un registre, tirée sur le serveur

- [ ] `docker logout ghcr.io && docker pull ghcr.io/sephorah/exo2-portail-depot-backend:<tag>` →
      succès **sans identifiants** (un 403 et une image inexistante se ressemblent : c'est pourquoi
      le test se fait déconnecté)
- [ ] `grep -n "image:" infra/docker-compose.yml` → les deux services pointent sur `ghcr.io/…`, et
      **aucun `build:`** ne subsiste dans ce fichier

### A7. Déploiement sur le serveur fourni, HTTPS réel Let's Encrypt

- [ ] `curl -I https://sephorah-aniambossou.stage2-div.rayan-drissi.com/` → **200**
- [ ] `openssl s_client -connect sephorah-aniambossou.stage2-div.rayan-drissi.com:443 -servername sephorah-aniambossou.stage2-div.rayan-drissi.com </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates`
      → émetteur **Let's Encrypt** (pas le serveur de test), dates valides
- [ ] `curl -I http://sephorah-aniambossou.stage2-div.rayan-drissi.com/` → **301** vers `https://`

### A8. Export des conversations IA joint au rendu

- [ ] `ls ai-logs/` → les sessions exportées sont présentes
- [ ] **Case ouverte, et elle le reste :** le caviardage ligne à ligne de `ai-logs/` n'est pas fait
      (issue H3). À vérifier avant le rendu : aucun secret, aucun jeton, aucun mot de passe

### A9. Parcours complet

- [ ] Connexion avocat → `/dashboard`
- [ ] Créer « Dossier Martin, pièces 2026 » avec trois pièces → l'écran affiche le **lien client et
      le PIN**, une seule fois
- [ ] Recharger la page → le PIN **n'est plus affiché** (il est haché ; le retrouver impose de
      régénérer le lien)
- [ ] En navigation privée : ouvrir le lien → écran PIN ; PIN faux → refus ; PIN juste → la liste
      des trois pièces attendues
- [ ] Déposer un PDF sur la première pièce → barre de progression, puis la pièce passe à *reçue*
- [ ] Déposer les deux autres → la progression client affiche **3/3**
- [ ] Côté avocat, recharger `/dashboard` → la demande est **complète**
- [ ] Télécharger la pièce déposée depuis l'écran avocat, puis
      `cmp fichier-original.pdf fichier-telecharge.pdf` → **aucune différence**, octet pour octet
- [ ] `curl -i http://127.0.0.1:21600/api/v1/requests/<id>/items/<itemId>/file` sans cookie → **401**

---

## B. Critères attendus

### B1. Tests Jest sur la logique métier

Les trois sujets nommés par l'énoncé — expiration du lien, vérification du PIN, transitions de statut.

- [ ] `pnpm -C backend test` → vert
- [ ] `pnpm -C backend test:e2e` → vert (**Docker requis**)
- [ ] `pnpm -C backend test:integration` → vert, contre un vrai MinIO sous la vraie policy
- [ ] `pnpm -C frontend test` → vert
- [ ] Expiration : `pnpm -C backend test request-status` et le cas
      « dies as soon as the link expires » de `test/public.e2e-spec.ts`
- [ ] PIN : le bloc *unlock* de `src/public/public.service.spec.ts` et `test/public.e2e-spec.ts`
      (réponses **indistinguables** entre lien inconnu, révoqué, expiré et PIN faux)
- [ ] Transitions de statut : `src/requests/request-status.spec.ts`, dont
      « stays complete once every piece is in, even past the deadline »

### B2. Pile d'alerting Prometheus + Grafana

- [ ] `docker compose … ps` → `prometheus` et `grafana` *healthy*
- [ ] http://127.0.0.1:21600/grafana/ → connexion `admin` / `GRAFANA_ADMIN_PASSWORD` du `.env`
- [ ] Tableau de bord *Portail dépôt* : **11 panneaux**, aucun en *No data* après un parcours joué
- [ ] *Alerting → Alert rules* : **4 règles**, toutes en **Normal**
- [ ] Provoquer une panne : `docker compose … stop minio`, attendre l'intervalle d'évaluation →
      l'alerte de dépendance passe en **Firing** ; `start minio` → retour à *Normal*
- [ ] **Case ouverte, dite telle quelle :** les alertes sont **visibles, non poussées** — aucun SMTP
      n'est configuré, donc personne n'est prévenu hors de l'écran
- [ ] **Piège vérifié :** un compteur porteur d'étiquettes n'émet **aucune série** tant qu'il n'a
      jamais été incrémenté. Sur une pile fraîche, `portal_deposits_total` n'affiche que son
      en-tête — c'est pourquoi l'alerte de taux d'échec est en `noDataState: OK`, sans quoi le
      portail alerterait dès son installation

### B3. Respect de la direction artistique

**C'est ici que se joue la seule vérification qui n'a aucun filet automatique.** jsdom ne calcule
aucun style : les tests frontend disent qu'un bouton existe, jamais qu'il est violet, ni qu'il
s'inverse au survol, ni que la densité tient sur mobile.

C'est pourquoi les **35 cas du dossier `theme/`** ont été retirés : ils relisaient des jetons de
style et donnaient l'illusion de couvrir la charte sans rien en prouver. Deux ont été gardés, et
seulement parce qu'ils portent un vrai piège Chakra : `badge.test.tsx` (une variante `size` divisait
la marge par deux en silence) et `field.test.tsx` (l'étiquette liée à son champ, qui est de
l'accessibilité, pas du style). **Les cases ci-dessous sont donc la seule preuve de la charte.**

- [ ] Survol du bouton principal → **inversion** des couleurs, et le libellé **ne bouge pas d'un
      pixel** (l'anneau est un `box-shadow: inset`, pas une bordure ; une bordure décalerait le
      texte)
- [ ] Violet `#7B2CFF`, police Inter, rayons et espacements conformes au kit sur `/login`,
      `/dashboard`, `/requests/new`, le détail d'une demande et l'écran client
- [ ] Largeur **375 px** (mobile) puis **1440 px** : la densité reste constante, rien ne déborde,
      aucun texte tronqué — issue **E2**, encore ouverte
- [ ] Console du navigateur sur chaque écran → **aucune violation CSP**
- [ ] **Case ouverte, dite telle quelle :** `style-src 'unsafe-inline'` est imposé par Chakra v3 ;
      les violations CSP *ne sont donc pas comptées* sur les styles en ligne, seulement sur les
      scripts et les origines

### B4. README qui justifie l'architecture et le périmètre d'observabilité

- [ ] `README.md` couvre : produit, installation, architecture (dont **pourquoi pas Next.js**),
      modèle de données, stratégie de test, observabilité, **limites connues**
- [ ] Chaque métrique exposée a sa justification écrite — la question à laquelle elle répond
- [ ] Chaque seuil d'alerte est justifié, et `docs/observabilite.md` sert de runbook
- [ ] Les limites connues sont nommées sans euphémisme, dont : pas de limitation de débit sur le PIN
      (détectée, pas empêchée), pas d'antivirus, alertes non poussées, `linux/amd64` seulement, la
      production épingle un **tag** qui est mutable

### B5. Secrets hors du dépôt, `.env.example` complet

- [ ] `git ls-files | grep -x .env` → **aucun résultat**
- [ ] `git log --all --oneline -- .env` → **aucun commit**
- [ ] Chaque clé de `.env` existe dans `.env.example`, et réciproquement :
      `diff <(grep -oE '^[A-Z_]+=' .env | sort) <(grep -oE '^[A-Z_]+=' .env.example | sort)`
      → **aucune différence**
- [ ] `.env.example` ne contient **aucune valeur secrète** : les clés sensibles y sont vides
- [ ] `grep -rn "password\|secret\|PIN" --include="*.log" .` sur les journaux de la pile → aucun
      secret en clair
