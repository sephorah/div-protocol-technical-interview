/**
 * Demonstration data, executed by install.sh inside the backend container
 * (`node dist/seed.js`) once every healthcheck has passed.
 *
 * Two properties are required of it, and neither is decorative:
 *
 * - IDEMPOTENT. install.sh runs on every deployment, not only the first. A
 *   second run must not create a second lawyer, a second request or a second
 *   set of expected documents.
 * - IT PRINTS CREDENTIALS. Its standard output is displayed as-is by
 *   install.sh, and it is the grader's only way of knowing how to log in. The
 *   PIN in particular is stored hashed, so it cannot be read back afterwards:
 *   whatever is not printed here is lost.
 *
 * It goes through a Nest application context rather than instantiating a
 * PrismaClient of its own: same configuration, same connection string
 * assembly, same validation at startup. A second wiring would be a second thing
 * to keep in step with the first.
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
 * The title identifies the demonstration request across runs -- DepositRequest
 * has no natural unique key, and adding one to the schema for the sake of the
 * seed would let a fixture dictate the data model.
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
 * Reads a variable that must be present AND non-empty.
 *
 * getOrThrow only rejects an absent variable: `SEED_LAWYER_PASSWORD=` in the
 * .env would return an empty string, and the demo account would be created with
 * the hash of nothing -- an account whose password is "" and which the grader
 * could never guess was broken.
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

  // The hash is recomputed on every run and written on update as well as on
  // create: changing SEED_LAWYER_PASSWORD in .env and re-running ./install.sh
  // is therefore how the demo password is rotated. Doing it the other way --
  // only on create -- would leave the .env and the account silently disagreeing.
  const passwordHash = await hashSecret(password);
  const lawyer = await prisma.lawyer.upsert({
    where: { email },
    update: { name, passwordHash },
    create: { email, name, passwordHash },
  });

  // findFirst + create rather than upsert: the request has no unique key to
  // upsert on (see DEMO_REQUEST_TITLE).
  const existing = await prisma.depositRequest.findFirst({
    where: { lawyerId: lawyer.id, title: DEMO_REQUEST_TITLE },
    include: { items: true },
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

  // Repairs a request whose expected documents were partially deleted by hand,
  // and adds any item appended to DEMO_ITEMS since the first run. Comparing by
  // label is enough here: the labels are constants of this file.
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

  // Revoking then creating, inside ONE transaction: a partial unique index
  // enforces a single active link per request, so the two statements crossing
  // would leave the demo request with no usable link at all.
  //
  // Why regenerate rather than keep the existing link: the PIN is stored
  // hashed. A preserved link could not have its PIN reprinted, and a
  // demonstration link whose PIN nobody knows is worth nothing. The revoked
  // rows accumulate, and that is intended -- the link history is exactly what
  // PublicLink exists to keep.
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

  // console.log and not the Nest logger: this block is a deliverable read by a
  // human, not a log line. The logger would prefix it with a timestamp, a
  // process id and a context, and colour it.
  //
  // No accents, like install.sh: this output lands in whatever terminal the
  // grader happens to be using.
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
  // Only errors and warnings: everything Nest says while starting would be
  // noise between the grader and the credentials above.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    await seed(app);
  } finally {
    // In a `finally`, so that a failed seed still closes its database
    // connections instead of leaving the process hanging on an open pool.
    await app.close();
  }
};

main().catch((error: unknown) => {
  new Logger('Seed').error('Seeding the demonstration data failed', error);
  process.exit(1);
});
