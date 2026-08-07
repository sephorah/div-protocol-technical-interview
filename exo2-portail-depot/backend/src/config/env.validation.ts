/**
 * Validation des variables d'environnement, executee par ConfigModule avant
 * que le moindre module ne soit instancie.
 *
 * Sans ce controle, une DATABASE_URL absente ne se manifeste qu'au premier
 * appel qui touche la base : 500 en production, sur une route sans rapport
 * apparent avec la configuration. Ici l'application refuse de demarrer et
 * `main.ts` transforme le rejet en message nomme + code de sortie 1, ce que
 * `restart: unless-stopped` et `docker compose logs` savent exploiter.
 *
 * Regle absolue : ne jamais recopier la valeur d'une variable dans un
 * message d'erreur. DATABASE_URL contient le mot de passe Postgres, et un
 * message d'erreur finit dans les logs, eux-memes agreges ailleurs.
 */

const ATTENDU = 'attendu : postgresql://utilisateur:motdepasse@hote:port/base';

const PROTOCOLES = new Set(['postgres:', 'postgresql:']);

/**
 * Analyse la chaine plutot que de la comparer a une expression reguliere.
 *
 * Une regex `^postgres(ql)?:\/\/.+` acceptait `postgresql://x` : ni hote
 * exploitable, ni base. La chaine passait le demarrage et echouait plus tard
 * dans le driver, avec un message moins clair — exactement ce que cette
 * validation existe pour eviter.
 *
 * `new URL` refuse en plus les mots de passe non encodes contenant / # ou ?,
 * qui rendent l'URL invalide. C'est le cas de figure produit par une
 * DATABASE_URL reconstruite dans docker-compose.yml a partir d'un
 * POSTGRES_PASSWORD contenant un caractere reserve : sans ce controle,
 * l'echec arrive au premier acces a la base, sans nommer sa cause.
 */
function analyser(url: string): string | null {
  let parsee: URL;
  try {
    parsee = new URL(url);
  } catch {
    return `DATABASE_URL n'est pas une URL analysable — un mot de passe contenant / # ? ou % doit etre encode-URL (${ATTENDU}).`;
  }

  if (!PROTOCOLES.has(parsee.protocol)) {
    return `DATABASE_URL n'utilise pas le protocole PostgreSQL (${ATTENDU}).`;
  }
  if (parsee.hostname.length === 0) {
    return `DATABASE_URL ne designe aucun hote (${ATTENDU}).`;
  }
  // pathname vaut "/" quand aucune base n'est nommee, "/base" sinon.
  if (parsee.pathname.replace(/^\//, '').length === 0) {
    return `DATABASE_URL ne nomme aucune base de donnees (${ATTENDU}).`;
  }

  return null;
}

export function validateEnv(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const problemes: string[] = [];

  const databaseUrl =
    typeof raw.DATABASE_URL === 'string' ? raw.DATABASE_URL.trim() : '';

  if (databaseUrl.length === 0) {
    problemes.push('DATABASE_URL est absente ou vide.');
  } else {
    const probleme = analyser(databaseUrl);
    if (probleme !== null) {
      problemes.push(probleme);
    }
  }

  if (problemes.length > 0) {
    throw new Error(
      `Configuration d'environnement invalide :\n  - ${problemes.join('\n  - ')}\n` +
        'Voir .env.example pour la liste des variables attendues.',
    );
  }

  return { ...raw, DATABASE_URL: databaseUrl };
}
