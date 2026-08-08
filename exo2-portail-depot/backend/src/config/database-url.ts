/**
 * Construction de la chaine de connexion PostgreSQL a partir des variables
 * DB_*.
 *
 * Pourquoi ne pas ecrire DATABASE_URL directement dans .env : elle devait
 * alors etre definie deux fois, en entier pour l'hote et reconstruite par
 * concatenation dans docker-compose.yml pour le conteneur. Un mot de passe
 * contenant / # ? ou % produisait une URL invalide — le conteneur `db`
 * demarrait normalement et l'API echouait sans que le rapport avec le mot de
 * passe soit visible. La seule parade etait de le documenter.
 *
 * Ici l'assemblage a lieu une seule fois, et `encodeURIComponent` echappe
 * chaque composant : n'importe quelle valeur fonctionne. Entre l'hote et le
 * conteneur, seuls DB_HOST et DB_PORT changent.
 */

export interface DatabaseEnv {
  DB_HOST: string;
  DB_PORT: string | number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

export function buildDatabaseUrl(env: DatabaseEnv): string {
  const user = encodeURIComponent(env.DB_USER);
  const password = encodeURIComponent(env.DB_PASSWORD);
  // Le nom de la base est un segment de chemin : un `/` doit y etre echappe
  // aussi, sinon il ouvrirait un segment supplementaire.
  const database = encodeURIComponent(env.DB_NAME);

  return `postgresql://${user}:${password}@${env.DB_HOST}:${String(env.DB_PORT)}/${database}`;
}
