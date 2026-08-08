// Configuration du CLI Prisma (generate, migrate).
//
// En TypeScript, y compris dans l'image de production ou l'entrypoint lance
// `prisma migrate deploy` : le CLI charge ce fichier via jiti, qui transpile le
// TypeScript lui-meme et arrive par `prisma -> @prisma/config -> c12 -> jiti`,
// toutes en `dependencies`. Le paquet `typescript`, lui, est bien supprime par
// `pnpm prune --prod` — mais il n'est pas necessaire ici.
//
// La vraie contrainte est ailleurs, et elle est independante de l'extension :
// ce fichier ne doit PAS entrer dans la compilation, sinon le `rootDir` deduit
// par tsc passe de src/ a la racine du paquet et la sortie devient
// dist/src/main.js. D'ou son exclusion dans tsconfig.build.json.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';
// Importe depuis les sources, et non depuis dist/ : `pnpm build` lance
// `prisma generate` AVANT `nest build`, donc dist/ n'existe pas encore sur un
// clone neuf. Le Dockerfile embarque ce seul fichier source dans l'image finale
// pour que l'import y resolve aussi.
import { buildDatabaseUrl } from './src/config/database-url';

// Prisma 7 ne charge plus `.env` automatiquement des lors qu'un fichier de
// configuration existe. Le `.env` du projet vit a la racine du depot, un cran
// au-dessus de backend/ : c'est celui que docker compose lit aussi.
// En conteneur il est absent et les variables viennent de compose — d'ou le
// existsSync, qui evite un avertissement a chaque migration.
const rootEnv = resolve(__dirname, '..', '.env');
if (existsSync(rootEnv)) {
  loadDotenv({ path: rootEnv, quiet: true });
}

// Une DATABASE_URL explicite l'emporte, comme dans env.validation.ts : c'est ce
// qui permet de viser une base managee ou une base de CI. Sinon elle est
// construite a partir des DB_*, par la meme fonction que l'application — pas de
// seconde implementation qui puisse diverger.
const databaseUrl =
  process.env.DATABASE_URL ??
  buildDatabaseUrl({
    // Pas de valeur de repli : une variable absente doit faire echouer la
    // commande, pas viser silencieusement une base par defaut.
    DB_HOST: process.env.DB_HOST ?? '',
    DB_PORT: process.env.DB_PORT ?? '',
    DB_USER: process.env.DB_USER ?? '',
    DB_PASSWORD: process.env.DB_PASSWORD ?? '',
    DB_NAME: process.env.DB_NAME ?? '',
  });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
