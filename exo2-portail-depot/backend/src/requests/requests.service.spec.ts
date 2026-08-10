import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { verifySecret } from '../crypto/secrets';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RequestsService } from './requests.service';

const ORIGIN = 'https://portail.example.test';

/**
 * The token no longer travels on its own -- it only exists inside the returned
 * URL. Reading it back is what keeps the "stored hash matches what the lawyer
 * received" assertion as strong as it was.
 */
const tokenFrom = (url: string): string =>
  decodeURIComponent(url.slice(`${ORIGIN}/deposit/`.length));

/**
 * What this suite protects: that no secret reaches the database in clear. The
 * Prisma double records the payload it is handed, and the assertions read THAT
 * payload rather than the response -- a service returning the right thing while
 * writing the PIN in clear would pass any test that only looks at the response.
 */
describe('RequestsService.create', () => {
  const create = jest.fn();
  const prisma = { depositRequest: { create } } as unknown as PrismaService;
  const config = { getOrThrow: () => ORIGIN } as unknown as ConfigService;
  // create() never reaches the bucket; the double only satisfies the
  // constructor.
  const service = new RequestsService(prisma, config, {} as StorageService);

  const body = {
    title: 'Dossier Martin, pieces 2026',
    items: ["Piece d'identite", 'Contrat de bail signe'],
    expiresInDays: 7,
  };

  /** The payload handed to Prisma by the call under test. */
  interface WrittenData {
    title: string;
    lawyerId: string;
    items: { create: { label: string; position: number }[] };
    links: { create: { tokenHash: string; pinHash: string; expiresAt: Date } };
  }

  // The assertion is on the whole argument tuple: jest.fn() types its calls as
  // `any[]`, and indexing into that is exactly what the blocking lint refuses.
  const written = (call = 0): WrittenData => {
    const [{ data }] = create.mock.calls[call] as [{ data: WrittenData }];
    return data;
  };

  beforeEach(() => {
    create.mockReset();
    create.mockImplementation(({ data }: { data: WrittenData }) =>
      Promise.resolve({
        id: 'request-1',
        title: data.title,
        lawyerId: data.lawyerId,
        createdAt: new Date(),
        items: data.items.create.map((item, index) => ({
          id: `item-${index}`,
          label: item.label,
          position: item.position,
        })),
      }),
    );
  });

  it('stores the PIN as an argon2id hash of the PIN it returns', async () => {
    const view = await service.create('lawyer-1', body);
    const { pinHash } = written().links.create;

    expect(pinHash).toMatch(/^\$argon2id\$/);
    expect(pinHash).not.toBe(view.link.pin);
    await expect(verifySecret(view.link.pin, pinHash)).resolves.toBe(true);
  });

  it('stores the SHA-256 of the token, and never the token', async () => {
    const view = await service.create('lawyer-1', body);
    const link = written().links.create;

    expect(link.tokenHash).toBe(
      createHash('sha256')
        .update(tokenFrom(view.link.url), 'utf8')
        .digest('hex'),
    );
    // An exhaustive key list, so that a future field carrying a secret cannot
    // be added to the write without this test noticing.
    expect(Object.keys(link).sort()).toEqual([
      'expiresAt',
      'pinHash',
      'tokenHash',
    ]);
  });

  // Two requests created back to back must not share a secret: a generator
  // seeded once per process would pass every test above and hand the same PIN
  // to two different clients.
  it('draws a different token and PIN every time', async () => {
    const first = await service.create('lawyer-1', body);
    const second = await service.create('lawyer-1', body);

    expect(first.link.url).not.toBe(second.link.url);
    expect(first.link.pin).not.toBe(second.link.pin);
    expect(written(0).links.create.tokenHash).not.toBe(
      written(1).links.create.tokenHash,
    );
  });
});
