# Portail dépôt

Sous-domaine : https://sephorah-aniambossou.stage2-div.rayan-drissi.com

## Démarrage

```bash
./install.sh
```

C'est tout. Le script installe Docker s'il manque, génère la configuration et ses secrets,
construit les images, monte la stack, applique les migrations, et n'affiche les URLs qu'une fois
que le portail répond. Il n'y a rien à faire ensuite, et rien à lire ici pour y arriver.

Le portail est alors sur **http://127.0.0.1:21600**.

Comptez ~2 min si Docker est déjà présent, ~4 min sinon. Les appels suivants prennent quelques
secondes. `docker compose down` arrête tout.

## Développement

`install.sh` ne sert pas au développement quotidien : il monte la stack de production. Pour
travailler avec le rechargement à chaud (Node 22 et pnpm 11 requis sur la machine) :

```bash
pnpm install:all
pnpm db:up      # Postgres seul, sur 127.0.0.1:21632
pnpm dev        # API :3000, frontend :5173
```

---

_À documenter d'ici la fin : setup, architecture et choix justifiés, modèle de données, stratégie
de tests, périmètre d'observabilité et pourquoi ces métriques, limites connues._
