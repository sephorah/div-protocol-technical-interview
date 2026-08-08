/**
 * Validation des variables d'environnement, executee par ConfigModule avant
 * que le moindre module ne soit instancie.
 *
 * Sans ce controle, une configuration de base absente ne se manifeste qu'au
 * premier appel qui touche la base : 500 en production, sur une route sans
 * rapport apparent avec la configuration. Ici l'application refuse de demarrer
 * et `main.ts` transforme le rejet en message nomme + code de sortie 1, ce que
 * `restart: unless-stopped` et `docker compose logs` savent exploiter.
 *
 * Regle absolue : ne jamais recopier la valeur d'une variable dans un message
 * d'erreur. DB_PASSWORD et JWT_SECRET sont des secrets, et un message d'erreur
 * finit dans les logs, eux-memes agreges ailleurs.
 */

import { buildDatabaseUrl, DatabaseEnv } from './database-url';

const REQUIRED_DB_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
] as const;

const EXPECTED_URL =
  'attendu : postgresql://utilisateur:motdepasse@hote:port/base';

/**
 * PORT et API_PREFIX sont obligatoires et n'ont deliberement AUCUNE valeur par
 * defaut dans le code.
 *
 * Un `process.env.PORT ?? 3000` faisait ecouter l'API sur 3000 des que la
 * variable manquait, c'est-a-dire hors de la plage attribuee sur la machine
 * partagee (21600-21699). Un service qui demarre au mauvais endroit est plus
 * difficile a diagnostiquer qu'un service qui refuse de demarrer.
 */
const REQUIRED_APP_KEYS = ['PORT', 'API_PREFIX', 'BIND_ADDRESS'] as const;

const URL_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

function readString(raw: Record<string, unknown>, key: string): string {
  return typeof raw[key] === 'string' ? raw[key].trim() : '';
}

/**
 * Analyse la chaine plutot que de la comparer a une expression reguliere.
 *
 * Une regex `^postgres(ql)?:\/\/.+` acceptait `postgresql://x` : ni hote
 * exploitable, ni base. La chaine passait le demarrage et echouait plus tard
 * dans le driver, avec un message moins clair — exactement ce que cette
 * validation existe pour eviter.
 */
function inspectUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `DATABASE_URL n'est pas une URL analysable (${EXPECTED_URL}).`;
  }

  if (!URL_PROTOCOLS.has(parsed.protocol)) {
    return `DATABASE_URL n'utilise pas le protocole PostgreSQL (${EXPECTED_URL}).`;
  }
  if (parsed.hostname.length === 0) {
    return `DATABASE_URL ne designe aucun hote (${EXPECTED_URL}).`;
  }
  // pathname vaut "/" quand aucune base n'est nommee, "/base" sinon.
  if (parsed.pathname.replace(/^\//, '').length === 0) {
    return `DATABASE_URL ne nomme aucune base de donnees (${EXPECTED_URL}).`;
  }

  return null;
}

/**
 * Verifie PORT et API_PREFIX, et rend les valeurs normalisees.
 *
 * Ces controles sont communs aux deux chemins de configuration de la base : que
 * DATABASE_URL soit fournie ou construite ne change rien au fait que l'API doit
 * savoir ou ecouter.
 */
function inspectApp(
  raw: Record<string, unknown>,
  issues: string[],
): { PORT: number; API_PREFIX: string; BIND_ADDRESS: string } {
  const missing = REQUIRED_APP_KEYS.filter(
    (key) => readString(raw, key).length === 0,
  );
  if (missing.length > 0) {
    issues.push(
      `Variables d'application absentes ou vides : ${missing.join(', ')}.`,
    );
  }

  const port = Number(readString(raw, 'PORT'));
  if (
    !missing.includes('PORT') &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    issues.push("PORT n'est pas un port valide (entier entre 1 et 65535).");
  }

  // Le prefixe est concatene a des chemins de routes : une barre manquante au
  // debut ou une barre en trop a la fin produit des URLs comme « api/v1health »
  // ou « /api/v1//health », qui repondent 404 sans rien expliquer.
  const prefix = readString(raw, 'API_PREFIX');
  if (
    !missing.includes('API_PREFIX') &&
    (!prefix.startsWith('/') || (prefix.length > 1 && prefix.endsWith('/')))
  ) {
    issues.push(
      'API_PREFIX doit commencer par « / » et ne pas finir par « / » (attendu : /api/v1).',
    );
  }

  // BIND_ADDRESS n'a pas de valeur par defaut pour la meme raison que PORT, en
  // plus grave : app.listen(port) sans adresse ecoute sur 0.0.0.0. Sur la
  // machine de staging, PARTAGEE avec d'autres candidats, cela publierait l'API
  // sur toutes les interfaces — le proxy nginx cesserait d'etre le seul point
  // d'entree et la regle `deny all` sur la sonde deviendrait contournable.
  //
  // La valeur differe legitimement selon le contexte : 127.0.0.1 sur la
  // machine, 0.0.0.0 dans le conteneur (espace reseau isole, aucun port
  // publie, et nginx doit pouvoir joindre le service par le reseau interne).
  const bindAddress = readString(raw, 'BIND_ADDRESS');

  return { PORT: port, API_PREFIX: prefix, BIND_ADDRESS: bindAddress };
}

export function validateEnv(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const issues: string[] = [];
  const app = inspectApp(raw, issues);

  // Une DATABASE_URL fournie explicitement l'emporte : c'est ce qui permet de
  // viser une base managee ou une base de CI sans reecrire cinq variables.
  const explicitUrl = readString(raw, 'DATABASE_URL');

  if (explicitUrl.length > 0) {
    const issue = inspectUrl(explicitUrl);
    if (issue !== null) {
      issues.push(issue);
    }
    if (issues.length > 0) {
      throw new Error(formatError(issues));
    }
    return { ...raw, ...app, DATABASE_URL: explicitUrl };
  }

  const missing = REQUIRED_DB_KEYS.filter(
    (key) => readString(raw, key).length === 0,
  );
  if (missing.length > 0) {
    issues.push(
      `Variables de base de donnees absentes ou vides : ${missing.join(', ')}.`,
    );
  }

  const port = Number(readString(raw, 'DB_PORT'));
  if (
    !missing.includes('DB_PORT') &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    issues.push("DB_PORT n'est pas un port valide (entier entre 1 et 65535).");
  }

  if (issues.length > 0) {
    throw new Error(formatError(issues));
  }

  const env: DatabaseEnv = {
    DB_HOST: readString(raw, 'DB_HOST'),
    DB_PORT: port,
    DB_USER: readString(raw, 'DB_USER'),
    DB_PASSWORD: readString(raw, 'DB_PASSWORD'),
    DB_NAME: readString(raw, 'DB_NAME'),
  };

  // DATABASE_URL est expose au reste de l'application : PrismaService et le
  // CLI Prisma continuent de lire une seule variable, celle qu'ils attendent.
  return { ...raw, ...env, ...app, DATABASE_URL: buildDatabaseUrl(env) };
}

function formatError(issues: string[]): string {
  return (
    `Configuration d'environnement invalide :\n  - ${issues.join('\n  - ')}\n` +
    'Voir .env.example pour la liste des variables attendues.'
  );
}
