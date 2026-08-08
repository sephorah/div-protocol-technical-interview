/**
 * Primitives cryptographiques du portail : generation et verification des
 * secrets qui protegent un lien de depot.
 *
 * Elles vivent ici plutot que dans les services metier pour que les decisions
 * de securite tiennent en un seul fichier relisable, et pour que B1 (auth
 * avocat), B2 (creation de demande) et C1 (deverrouillage par PIN) partagent
 * exactement le meme traitement.
 *
 * Regle commune : tout tirage aleatoire passe par node:crypto, jamais par
 * Math.random — ce dernier est un generateur pseudo-aleatoire de V8, dont la
 * suite se reconstitue a partir de quelques sorties observees.
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';
import * as argon2 from 'argon2';

/**
 * Parametres argon2id, configuration de reference OWASP
 * (19 Mio de memoire, 2 iterations, 1 voie).
 *
 * Le defaut de la bibliotheque (64 Mio, 3 iterations) a ete mesure a ~312 ms
 * par hachage sur cette machine, contre ~67 ms ici. L'ecart n'achete pas grand
 * chose — les hachages sont sales, donc le seul gain porte sur une attaque hors
 * ligne apres fuite de la base — et il se paie sur le chemin le plus expose du
 * portail : /public/:token/unlock, ouvert a un client anonyme. A 312 ms et
 * 64 Mio par requete, et tant que G1 (limitation de debit) n'existe pas, c'est
 * un facteur d'amplification confortable pour saturer l'API a peu de frais.
 *
 * Ces valeurs sont volontairement des constantes et non des variables
 * d'environnement : un parametre de cout mal renseigne degrade la securite en
 * silence. Les augmenter plus tard n'invalide pas les hachages existants, la
 * chaine PHC stockee portant ses propres parametres.
 */
// `satisfies` plutot qu'une annotation de type : argon2.hash a deux
// surcharges, et celle qui accepte `raw: true` renvoie un Buffer. Annoter la
// constante avec HashOptions rendrait `raw` potentiellement present, donc le
// retour potentiellement binaire. En laissant le type infere, c'est la
// surcharge « chaine PHC » qui est retenue — tout en verifiant les cles.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} satisfies argon2.HashOptions;

/** Longueur du token public, en octets. 32 octets = 256 bits d'entropie. */
const TOKEN_BYTES = 32;

/** Le PIN fait 4 chiffres, comme impose par l'enonce. */
const PIN_DIGITS = 4;

/**
 * Token du lien public : 256 bits tires du generateur du systeme, encodes en
 * base64url.
 *
 * base64url plutot qu'hexadecimal : 43 caracteres au lieu de 64 pour la meme
 * entropie, et un alphabet sur pour une URL comme pour un QR code — ce lien est
 * fait pour etre colle dans un courriel.
 *
 * randomUUID() est ecarte : un UUIDv4 ne porte que 122 bits et sa structure est
 * reconnaissable au premier coup d'oeil.
 */
export function generatePublicToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Ce qui est reellement stocke en base a la place du token.
 *
 * Le token est une credential au porteur : le detenir suffit a atteindre la
 * demande. Le garder en clair reproduirait, sur le lien, la faute qu'on refuse
 * pour le mot de passe — une fuite de la base livrerait tous les liens actifs.
 *
 * SHA-256 et non argon2id : argon2 sert a rendre couteux le bruteforce d'un
 * secret a faible entropie. Un token de 256 bits ne se devine pas, et un
 * hachage rapide garde la recherche indexee en une seule lecture.
 */
export function hashPublicToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * PIN a 4 chiffres, zeros de tete conserves — d'ou le type string : « 0042 »
 * est un PIN valide, 42 n'est pas la meme chose.
 *
 * randomInt est non biaise (il rejette les tirages qui deborderaient de
 * l'intervalle), la ou Math.floor(Math.random() * 10000) serait a la fois
 * biaise et previsible.
 */
export function generatePin(): string {
  return String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, '0');
}

/**
 * Hache un mot de passe ou un PIN en argon2id.
 *
 * Le resultat est une chaine PHC (`$argon2id$v=19$m=...$sel$hachage`) qui
 * embarque sel et parametres : c'est elle qu'on stocke, et verifySecret relit
 * les parametres depuis le hachage plutot que depuis la configuration courante.
 */
export function hashSecret(value: string): Promise<string> {
  return argon2.hash(value, ARGON2_OPTIONS);
}

/**
 * Verifie une valeur contre un hachage stocke.
 *
 * Un hachage illisible (colonne tronquee, donnee migree a la main) renvoie
 * false au lieu de lever : sur le chemin de deverrouillage, une exception
 * remonterait en 500 la ou un PIN faux renvoie une erreur d'authentification,
 * ce qui donnerait a un attaquant un moyen de distinguer les deux cas.
 */
export async function verifySecret(
  value: string,
  storedHash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, value);
  } catch {
    return false;
  }
}

/**
 * Cle de l'objet dans MinIO.
 *
 * Prefixee par demande : MinIO n'a pas de repertoires, mais l'API S3 sait
 * lister et supprimer par prefixe. Supprimer une demande devient donc un
 * effacement sur `requests/<requestId>/`, qui reste correct meme quand la
 * cascade SQL a deja fait disparaitre les lignes portant les cles.
 *
 * Le nom depose par le client n'entre dans la cle qu'apres assainissement, et
 * il est de toute facon precede d'un identifiant aleatoire : deux fichiers de
 * meme nom ne peuvent pas se recouvrir, et aucune sequence `../` ne survit.
 * Le nom d'origine reste en base, pour l'affichage seulement.
 */
export function buildStorageKey(
  requestId: string,
  itemId: string,
  originalName: string,
): string {
  const safeName =
    originalName
      .normalize('NFKD')
      // Tout ce qui n'est pas alphanumerique, point, tiret ou souligne devient
      // un tiret : cela neutralise `/`, `\` et les octets de controle.
      .replace(/[^A-Za-z0-9._-]/g, '-')
      // Les points consecutifs sont reduits a un seul. Les separateurs ayant
      // deja disparu, `..` ne peut plus remonter d'un cran ici — mais la cle
      // finit par etre lue par d'autres outils (synchronisation, extraction
      // d'archive) qui, eux, savent l'interpreter.
      .replace(/\.{2,}/g, '.')
      // Un nom reduit a des points ou a des tirets ne doit pas subsister comme
      // segment de chemin, ni produire un fichier cache.
      .replace(/^[.-]+/, '')
      .slice(0, 100) || 'fichier';

  return `requests/${requestId}/items/${itemId}/${randomBytes(8).toString('hex')}-${safeName}`;
}
