# Observabilité

Ce que le portail mesure, pourquoi, et quoi faire quand une alerte se déclenche. Ce document est
aussi le **runbook** : chaque alerte y a son geste.

Grafana est le seul point d'entrée (`<origine>/grafana/`, compte `admin`, mot de passe généré par
`install.sh`). Prometheus ne publie aucun port et n'est joignable que par Grafana.

---

## Le principe

**Chaque métrique répond à UNE question d'exploitation.** Une métrique sur laquelle personne ne peut
agir est une série temporelle à stocker pour toujours : en ajouter une, c'est apporter sa question
avec elle. C'est la règle que `backend/src/metrics/metrics.service.ts` applique, un commentaire par
déclaration.

Le registre est **le nôtre**, pas celui par défaut de `prom-client`. Deux raisons, toutes deux
visibles en test : le registre global survit d'un fichier de test à l'autre, donc une seconde
instance lèverait sur un nom déjà enregistré ; et une bibliothèque qui s'enregistrerait dedans
fuirait dans le scrape du portail sans qu'une ligne du dépôt ne change.

`/api/v1/metrics` est en **`deny all`** dans nginx : publié, il dirait à qui scanne combien de
demandes existent, quand les dépôts ont lieu, combien de PIN ont été refusés et quelle dépendance est
en panne. Son seul consommateur est Prometheus, sur le réseau interne.

---

## Les cinq métriques

| Métrique | Type | La question |
|---|---|---|
| `portal_deposits_total{outcome}` | compteur | le produit fait-il son seul travail ? Une pointe de `rejected_type` dit que les clients ne comprennent pas la liste des formats acceptés |
| `portal_unlock_attempts_total{outcome}` | compteur | une pointe de `failure` est la signature d'une force brute sur les 10 000 combinaisons du PIN |
| `portal_expired_link_hits_total` | compteur | des clients arrivent-ils après la mort du lien ? Un compte qui monte dit que la durée par défaut est trop courte — décision produit, pas incident |
| `portal_requests_completed_total` | compteur | combien de **dossiers** aboutissent — `deposits_total` compte des **fichiers** |
| `portal_http_request_duration_seconds{method,route,status}` | histogramme | la latence par route, base de toute alerte de disponibilité — et la seule qui voie une route que personne n'a instrumentée à la main |

Plus les métriques par défaut de `prom-client` (retard de la boucle d'événements, tas, descripteurs,
CPU) : elles distinguent « l'API est lente » de « la machine est saturée », ce qui est la première
question que pose toute alerte de latence, et coûtent une ligne.

### Deux précisions qui changent la lecture

**`portal_requests_completed_total` compte la TRANSITION**, pas l'état. Le compteur n'avance que
lorsqu'un dépôt fait passer la demande d'incomplète à complète. Sans cela, un client qui remplace un
fichier déjà déposé ferait monter le compteur et le taux d'aboutissement dépasserait 100 %.

« Complète » y veut dire exactement ce qu'il veut dire ailleurs : **aucune pièce sans fichier
`complete`**. Compter la simple présence d'un fichier ferait déclarer aboutie une demande dont une
pièce a été refusée, pendant que le tableau de bord l'affiche toujours *en attente*.

Sa limite connue : **deux dépôts concurrents sur les deux dernières pièces peuvent tous deux
constater « rien ne manque »** et incrémenter, donc sur-compter d'une unité. Le fermer demanderait une
colonne marqueur ou une sérialisation de la transaction — un coût réel sur le chemin du dépôt, pour
un écart de comptage sur une métrique de tendance. Assumé.

**Aucune série ne porte de taille de fichier, et c'est une décision.** Deux histogrammes ont existé —
la taille des fichiers acceptés, celle déclarée pour les fichiers refusés — et tous deux ont été
retirés. Le second doublait `deposits_total{outcome="rejected_size"}` ; le premier n'observait que
les fichiers **acceptés**, donc il ne pouvait rien dire du plafond, alors que ce qui le calibre est
le refus. Aucune alerte ne les lisait. Ce qu'on perd : plus rien ne dit à quelle vitesse le bucket
grossit.

**Le plafond du proxy reste plus haut que celui du produit** : nginx refuse au-delà de 25 Mo
(`client_max_body_size`) avant que le backend ne voie la requête, alors que le produit s'arrête à
20 Mio. Mesuré sur la pile réelle — un fichier de 40 Mo produit un 413 de nginx et le backend n'en
sait rien ; un fichier de 22 Mo traverse et compte un `rejected_size`. Le plafond du proxy coupe
l'envoi sur l'en-tête, sans bufferiser un octet.

### Le piège qui fait croire à une métrique cassée

**Un compteur porteur d'étiquettes n'émet AUCUNE série tant qu'il n'a jamais été incrémenté.** Sur
une pile fraîche, `portal_deposits_total` n'affiche que son en-tête, et le panneau correspondant est
vide. C'est normal, et c'est pourquoi l'alerte de taux d'échec est en `noDataState: OK` : sans cela,
le portail alerterait dès son installation. Les histogrammes sans étiquette, eux, émettent leurs
tranches à zéro dès le démarrage.

---

## Le tableau de bord

Neuf panneaux, provisionnés depuis `infra/grafana/dashboards/portail.json` — **la source de vérité
est le fichier**. Le fournisseur interdit l'édition depuis l'interface : une modification cliquée
serait perdue au prochain démarrage.

Cinq indicateurs en tête (API, dépôts aboutis, taux d'échec, PIN refusés, liens expirés touchés),
puis les séries : dépôts par issue, tentatives de déverrouillage, latence p95 par route, taille des
fichiers déposés, demandes abouties sur 24 h, taille déclarée des fichiers refusés.

**Tout est provisionné — tableau de bord, alertes et source de données sont des fichiers du dépôt.**
Ce qui serait cliqué dans l'interface ne vivrait que dans le volume `grafana_data` et disparaîtrait
avec lui sans que rien ne le signale.

### Trois réglages de Grafana qui se paient cher

- **Les trois sous-répertoires de provisionnement sont montés un par un**, jamais
  `/etc/grafana/provisioning` en entier : l'image en fournit d'autres (`plugins/`,
  `access-control/`, `notifiers/`), et les recouvrir les fait disparaître. Grafana journalise alors
  une erreur de provisionnement à chaque démarrage — un bruit permanent qui apprend à ignorer
  précisément les erreurs qui comptent ici.
- **`GF_PLUGINS_PREINSTALL_DISABLED`** : par défaut, Grafana 13 télécharge cinq greffons au démarrage
  (exploretraces, metricsdrilldown, elasticsearch, lokiexplore, pyroscope). Aucun ne sert, ils
  supposent un accès internet, et l'un d'eux échouait de toute façon en `level=error` sur une
  permission refusée à chaque démarrage. Avec les deux variables d'analytics, c'est la position du
  projet : **aucun composant ne contacte de tiers** — la même raison qui a fait auto-héberger la
  police du frontend.
- **Le healthcheck porte `/grafana/`**, et c'est ce qui le rend utile : sans
  `serve_from_sub_path`, Grafana répond 302 sur ce chemin et `curl -fsS` échoue, donc le conteneur
  devient *unhealthy* au lieu de laisser découvrir une interface blanche au navigateur.

---

## Les alertes, et leur runbook

Quatre règles, provisionnées elles aussi. **La cadence d'évaluation doit être un multiple de 10 s** —
la période de base de l'ordonnanceur de Grafana. Un `15s`, la valeur naturelle puisque c'est le
`scrape_interval` de Prometheus, fait échouer **tout** le provisionnement et le conteneur sort en
erreur (`invalid alert rule: interval (15s) should be … divided exactly by scheduler interval: 10`).
D'où `30s`, premier multiple au-dessus du scrape — évaluer plus souvent que Prometheus ne collecte ne
ferait que relire deux fois le même échantillon.

Chaque règle est en deux temps : `refId A` est une requête Prometheus instantanée, `refId C` une
expression de seuil. Un seul `refId` ne suffit pas, Grafana exigeant que la condition porte sur une
expression.

### 1. API injoignable — `up < 1` pendant 1 min

**Pourquoi 1 minute** : le scrape est toutes les 15 s, donc une minute vaut quatre scrapes ratés
d'affilée. En dessous, chaque mise à jour d'image déclencherait l'alerte pour rien, et le
`start_period` du healthcheck backend est déjà de 60 s.

`noDataState: Alerting` : l'absence de donnée signifie que la cible a disparu, ce qui **est** la panne
surveillée. La traiter en « OK » rendrait l'alerte silencieuse au pire moment.

**Geste :** `docker compose -f infra/docker-compose.yml --env-file .env logs backend`. Aucun dépôt ni
aucune connexion avocat n'est possible pendant ce temps.

### 2. Taux d'échec de dépôt > 10 % sur 5 min, avec un plancher de 5 dépôts

**Le 10 %** : un `rejected_type` isolé est une erreur d'utilisateur normale (un `.docx` à la place
d'un PDF). Au-delà d'un dépôt sur dix, ce n'est plus individuel — soit la liste des formats n'est pas
comprise, soit le stockage refuse les écritures.

**Le plancher de 5 dépôts est le piège à ne pas rouvrir** : sans lui, un seul fichier refusé sur
trois donne 33 %, donc une alerte critique pour un client qui s'est trompé de fichier. Le `and` de
PromQL ne rend la valeur de gauche que si la condition de droite est vraie ; en dessous de 5 dépôts
la requête ne rend rien, et `noDataState: OK` fait le reste — aucun dépôt la nuit n'est pas un
incident.

`outcome!="success"` plutôt qu'une énumération : un `outcome` ajouté plus tard entre dans le calcul
sans qu'on ait à y penser.

**Geste :** répartir les échecs par `outcome` sur le tableau de bord. `error` en tête pointe le
stockage ; `rejected_type` pointe l'interface, qui laisse choisir un format refusé.

### 3. Plus de 20 PIN erronés en 5 min — force brute

**C'est l'alerte qui remplace la limitation de débit sur le PIN, coupée du périmètre. Elle DÉTECTE,
elle n'EMPÊCHE pas** : ce qui borne le débit d'un attaquant reste le coût d'argon2id, 67 ms mesurées
par essai.

**Le seuil** : 20 échecs en 5 min, soit 4 par minute. Un vrai client se trompe une à trois fois,
jamais vingt — le seuil est hors de portée d'un usage normal. Il est aussi très en dessous de ce
qu'un attaquant doit tenir : à 4 essais par minute, balayer 10 000 combinaisons prend 42 heures, donc
l'alerte part dès les premières minutes d'une attaque.

`increase()` et non `rate()` : le seuil est un **nombre** d'essais, pas une fréquence, et `increase()`
rattrape déjà une remise à zéro du compteur au redémarrage du backend. `for: 0s` : c'est un signal de
sécurité, la fenêtre de 5 min lisse déjà le bruit et attendre en plus retarderait la seule détection
qui existe.

**Geste :** révoquer le lien concerné (`DELETE /api/v1/requests/:id/link`), puis le régénérer. La
réponse est manuelle, faute de limitation de débit.

### 4. Dépendance injoignable (MinIO ou Postgres) — une réponse 503 sur `/health`

**Le signal et sa limite.** Prometheus ne scrape pas MinIO : ses métriques demandent une
authentification, et `prometheus.yml` ne déclare que le backend. Ce qui reste visible est la sonde
`/health`, qui répond 503 dès que MinIO **ou** Postgres ne répond pas, et que l'intercepteur de
latence compte comme n'importe quelle autre réponse.

**Ce qui la fait battre en continu est le healthcheck docker du backend**, qui appelle `/health`
toutes les 30 s depuis son propre conteneur. Le retirer du compose rendrait cette alerte silencieuse
sans rien casser de visible.

Il n'y a pas de taux acceptable : un backend qui ne sait plus stocker fait échouer chaque dépôt.
`for: 1m` écarte le hoquet isolé. `noDataState: OK` parce que l'absence totale de scrape est
l'alerte 1, inutile de doubler.

Le `route=~` couvre les deux formes possibles de l'étiquette selon la façon dont Express rend la
route appariée. **Un `route=` exact qui tombe à côté ne produirait aucune erreur** : l'alerte ne se
déclencherait simplement jamais.

**Geste :** la règle ne distingue pas les deux dépendances ; lire le corps de la sonde, qui les nomme.

```bash
docker compose -f infra/docker-compose.yml --env-file .env exec backend \
  node -e "fetch('http://127.0.0.1:21610/api/v1/health').then(r=>r.text()).then(console.log)"
```

---

## Ce qui n'est pas fait, et qu'il faut dire

- **Aucun point de contact n'est configuré.** La machine n'a pas de SMTP, et pointer les alertes vers
  un destinataire injoignable donnerait l'illusion d'une notification. Les alertes sont donc
  **visibles** dans Grafana (*Alerting → Alert rules*), elles ne sont pas **poussées**. Ajouter un
  webhook ou un SMTP se fait par un fichier `contactPoints:` à côté des règles, sans toucher à
  celles-ci.
- **L'alerte de dépendance ne distingue pas Postgres de MinIO** : il faut lire la sonde.
- **Aucune trace distribuée, aucun log structuré agrégé.** Le périmètre choisi est métriques +
  alertes ; les journaux se lisent par `docker compose logs`.
- **Le renommage d'une métrique jette son historique.** `portail_` → `portal_` n'a rien coûté parce
  qu'il n'y avait pas d'historique ; ce ne serait plus vrai après une mise en service durable.
- **Prometheus ne recharge pas sa configuration tout seul.** Changer le `job_name` sans redémarrer le
  conteneur laisse les requêtes `up{job=…}` du tableau de bord et de l'alerte 1 sans aucune série —
  vérifié pendant ce nettoyage.
