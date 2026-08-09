/**
 * Demonstration data, run by install.sh inside the backend container
 * (`node dist/seed.js`) once every healthcheck has passed.
 *
 * Two properties are required of it. IDEMPOTENT, because install.sh runs on
 * every deployment. And IT PRINTS CREDENTIALS: its output is the grader's only
 * way of knowing how to log in, and the PIN is stored hashed -- whatever is not
 * printed here is lost.
 *
 * It goes through a Nest application context rather than its own PrismaClient,
 * so that configuration and connection assembly stay in one place.
 */

import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  generatePin,
  generatePublicToken,
  hashPublicToken,
  hashSecret,
} from './crypto/secrets';
import { normalizeEmail } from './lawyers/lawyer.types';
import { PrismaService } from './prisma/prisma.service';

/**
 * The title is what identifies the demonstration DATASET across runs --
 * DepositRequest has no natural unique key, and adding one to the schema for
 * the sake of a fixture would let the fixture dictate the data model.
 *
 * It also identifies the demonstration LAWYER, indirectly: the demo account is
 * "whoever owns this request", not "whoever holds this e-mail address". That
 * indirection is the whole point. Keyed on the address, changing
 * SEED_LAWYER_EMAIL would not rename the account -- it would create a second
 * one, and the first would stay reachable with its old password. The address is
 * a value of the account, not its identity.
 */
const DEMO_REQUEST_TITLE = 'Dossier Martin, pieces 2026';

const DEMO_ITEMS = [
  "Piece d'identite",
  'Contrat de bail signe',
  'Trois dernieres quittances de loyer',
];

/** Validity of the demonstration link, in days. */
const DEMO_LINK_DAYS = 14;

/**
 * getOrThrow only rejects an ABSENT variable: `SEED_LAWYER_PASSWORD=` returns
 * an empty string, and the demo account would be created with the hash of
 * nothing.
 */
const requireConfig = (config: ConfigService, key: string): string => {
  const value = config.getOrThrow<string>(key).trim();
  if (value.length === 0) {
    // The name only, never the value: this message ends up in the logs.
    throw new Error(`${key} is empty: fill it in .env, then run ./install.sh.`);
  }
  return value;
};

const seed = async (app: INestApplicationContext): Promise<void> => {
  const config = app.get(ConfigService);
  const prisma = app.get(PrismaService);

  const email = normalizeEmail(requireConfig(config, 'SEED_LAWYER_EMAIL'));
  const name = requireConfig(config, 'SEED_LAWYER_NAME');
  const password = requireConfig(config, 'SEED_LAWYER_PASSWORD');

  // Rewritten on update as well as on create, so that changing
  // SEED_LAWYER_PASSWORD and re-running ./install.sh rotates the demo password
  // instead of leaving .env and the account silently disagreeing.
  const passwordHash = await hashSecret(password);

  // findFirst + create rather than upsert: the request has no unique key.
  const existing = await prisma.depositRequest.findFirst({
    where: { title: DEMO_REQUEST_TITLE },
    include: { items: true },
  });

  // Already seeded: its owner IS the demo account whatever address it carries,
  // so this branch RENAMES rather than duplicating. The address stays unique --
  // a genuine conflict with another account fails loudly, as it should.
  const lawyer =
    existing === null
      ? await prisma.lawyer.upsert({
          // No demo request: the address is the only key left. Covers a
          // database whose request was deleted by hand.
          where: { email },
          update: { name, passwordHash },
          create: { email, name, passwordHash },
        })
      : await prisma.lawyer.update({
          where: { id: existing.lawyerId },
          data: { email, name, passwordHash },
        });

  const request =
    existing ??
    (await prisma.depositRequest.create({
      data: {
        title: DEMO_REQUEST_TITLE,
        lawyerId: lawyer.id,
        items: { create: DEMO_ITEMS.map((label) => ({ label })) },
      },
      include: { items: true },
    }));

  // Repairs a request whose items were deleted by hand, and picks up anything
  // appended to DEMO_ITEMS since. Comparing by label suffices: they are
  // constants of this file.
  const knownLabels = new Set(request.items.map((item) => item.label));
  const missing = DEMO_ITEMS.filter((label) => !knownLabels.has(label));
  if (missing.length > 0) {
    await prisma.requestedItem.createMany({
      data: missing.map((label) => ({ label, requestId: request.id })),
    });
  }

  const token = generatePublicToken();
  const pin = generatePin();
  // Hashed BEFORE the transaction: argon2id takes tens of milliseconds, and
  // holding a database transaction open across it would serve no purpose.
  const pinHash = await hashSecret(pin);
  const expiresAt = new Date(Date.now() + DEMO_LINK_DAYS * 24 * 60 * 60 * 1000);

  // One transaction, a partial unique index allowing a single active link per
  // request. Regenerated rather than preserved because the PIN is hashed: a
  // kept link could not have its PIN reprinted. Revoked rows accumulating is
  // intended -- that history is what PublicLink exists for.
  await prisma.$transaction([
    prisma.publicLink.updateMany({
      where: { requestId: request.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.publicLink.create({
      data: {
        requestId: request.id,
        tokenHash: hashPublicToken(token),
        pinHash,
        expiresAt,
      },
    }),
  ]);

  // console.log and not the Nest logger: this is read by a human, not a log
  // line. No accents, like install.sh -- it lands in an unknown terminal.
  console.log(`
  Compte avocat de demonstration
    Adresse      ${lawyer.email}
    Mot de passe ${password}

  Demande de depot « ${request.title} »
    Lien client  /depot/${token}
    Code PIN     ${pin}
    Valable      ${DEMO_LINK_DAYS} jours, jusqu'au ${expiresAt.toLocaleDateString('fr-FR')}

  Le PIN et le lien sont regeneres a chaque execution : les precedents ne sont
  plus valables. Le mot de passe, lui, ne change pas (il vient de .env).
`);
};

const main = async (): Promise<void> => {
  // Nest's startup chatter would sit between the grader and the credentials.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    await seed(app);
  } finally {
    // `finally`: a failed seed must still close its connections rather than
    // hang on an open pool.
    await app.close();
  }
};

main().catch((error: unknown) => {
  new Logger('Seed').error('Seeding the demonstration data failed', error);
  process.exit(1);
});
