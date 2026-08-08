import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Ce que ces tests prouvent : le contrat HTTP de la sonde. Un aller-retour SQL
 * qui aboutit donne 200 { db: 'up' }, un aller-retour qui echoue donne 503
 * { db: 'down' } — et non un 200 optimiste, ni un 500 qui melangerait la
 * sonde avec une panne applicative.
 *
 * Ce qu'ils ne prouvent PAS : que la connexion a un vrai Postgres fonctionne.
 * PrismaService est remplace par un double. La chaine reelle se verifie par
 * `docker compose up` + `curl /api/health` (voir ai-plans), et une base de
 * test dediee arrivera avec A2/D1, quand il y aura des requetes metier.
 */
describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;
  let healthPath: string;
  const queryRaw = jest.fn();

  const createApp = async (): Promise<void> => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: queryRaw,
        $connect: jest.fn(),
        $disconnect: jest.fn(),
      })
      .compile();

    // logger: false — les cas d'echec font journaliser la stack du driver par
    // la sonde. C'est le comportement voulu en production, mais ca noierait
    // la sortie des tests sous des traces attendues.
    app = moduleFixture.createNestApplication({ logger: false });

    // Le prefixe global est pose dans main.ts, que les tests ne traversent
    // pas. Sans cette ligne, la suite interrogerait /health et resterait verte
    // alors que la sonde reelle vit sous /api/v1/health — c'est precisement
    // l'adresse dont dependent le healthcheck docker et la regle `deny all`
    // de nginx.
    const apiPrefix = app.get(ConfigService).getOrThrow<string>('API_PREFIX');
    app.setGlobalPrefix(apiPrefix);
    healthPath = `${apiPrefix}/health`;

    await app.init();
  };

  beforeEach(async () => {
    queryRaw.mockReset();
    await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('repond 200 { status: ok, db: up } quand la base repond', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await request(app.getHttpServer())
      .get(healthPath)
      .expect(200)
      .expect({ status: 'ok', db: 'up' });

    // La sonde doit reellement interroger la base, pas se contenter de
    // constater que le provider existe : la connexion Prisma est paresseuse.
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('repond 503 { status: error, db: down } quand la base est injoignable', async () => {
    queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    );

    await request(app.getHttpServer()).get(healthPath).expect(503).expect({
      status: 'error',
      db: 'down',
    });
  });

  it('ne repond plus sur /health, hors prefixe', async () => {
    // Garde-fou du couplage avec l'infrastructure : nginx interdit
    // explicitement /api/v1/health et le healthcheck docker interroge cette
    // meme adresse. Si le prefixe cessait de s'appliquer, la sonde
    // redeviendrait publique sans qu'aucun autre test ne s'en apercoive.
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it("ne divulgue pas les details de connexion dans la reponse d'erreur", async () => {
    // Le message d'un driver Postgres contient l'hote, le port, la base et
    // parfois l'utilisateur. Il va dans les logs, pas dans la reponse HTTP.
    queryRaw.mockRejectedValue(
      new Error('password authentication failed for user "portail" at db:5432'),
    );

    const response = await request(app.getHttpServer())
      .get(healthPath)
      .expect(503);
    const body = JSON.stringify(response.body);

    expect(body).not.toContain('password');
    expect(body).not.toContain('portail');
    expect(body).not.toContain('5432');
  });
});
