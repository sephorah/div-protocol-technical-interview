/**
 * Charge par `setupFiles` dans jest-e2e.json, donc execute avant que les
 * fichiers de test — et donc AppModule — ne soient importes.
 *
 * C'est necessaire : `ConfigModule.forRoot()` s'evalue au moment ou le
 * decorateur @Module est lu, c'est-a-dire a l'import. Poser les variables dans
 * un `beforeAll` arrive trop tard, la validation a deja echoue.
 *
 * Consequence voulue : la suite ne depend d'aucun fichier .env, et tourne donc
 * a l'identique sur un poste, sur une machine vierge et en CI.
 *
 * Ces valeurs n'ouvrent aucune connexion : PrismaService est remplace par un
 * double dans chaque suite.
 */
process.env.PORT = '21610';
process.env.API_PREFIX = '/api/v1';
process.env.BIND_ADDRESS = '127.0.0.1';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5432';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'portail_depot_test';
