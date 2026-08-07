/**
 * Charge par `setupFiles` dans jest-e2e.json, donc execute avant que les
 * fichiers de test — et donc AppModule — ne soient importes.
 *
 * C'est necessaire : `ConfigModule.forRoot()` s'evalue au moment ou le
 * decorateur @Module est lu, c'est-a-dire a l'import. Poser la variable dans
 * un `beforeAll` arrive trop tard, la validation a deja echoue.
 *
 * Consequence voulue : la suite ne depend d'aucun fichier .env, et tourne donc
 * a l'identique sur un poste, sur une machine vierge et en CI.
 *
 * Cette URL n'ouvre aucune connexion : PrismaService est remplace par un
 * double dans chaque suite.
 */
process.env.DATABASE_URL =
  'postgresql://test:test@127.0.0.1:5432/portail_depot_test';
