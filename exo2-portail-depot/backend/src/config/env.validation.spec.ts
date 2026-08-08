import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const app = {
    PORT: '21610',
    API_PREFIX: '/api/v1',
    BIND_ADDRESS: '127.0.0.1',
  };

  const db = {
    ...app,
    DB_HOST: 'db',
    DB_PORT: '5432',
    DB_USER: 'portail',
    DB_PASSWORD: 'motdepasse',
    DB_NAME: 'portail_depot',
  };

  it('construit DATABASE_URL a partir des DB_*', () => {
    expect(validateEnv({ ...db })).toMatchObject({
      DATABASE_URL: 'postgresql://portail:motdepasse@db:5432/portail_depot',
    });
  });

  it('preserve les autres variables', () => {
    expect(validateEnv({ ...db, JWT_SECRET: 'x' })).toMatchObject({
      JWT_SECRET: 'x',
    });
  });

  it('supprime les espaces autour des valeurs', () => {
    expect(validateEnv({ ...db, DB_HOST: '  db  ' })).toMatchObject({
      DATABASE_URL: 'postgresql://portail:motdepasse@db:5432/portail_depot',
    });
  });

  /**
   * Le cas qui a motive tout ce module : une URL concatenee dans le compose
   * devenait inanalysable, ici elle est simplement encodee.
   */
  it('accepte un mot de passe contenant des caracteres reserves', () => {
    const result = validateEnv({ ...db, DB_PASSWORD: 'pa/ss#1?x' });

    expect(() => new URL(result.DATABASE_URL as string)).not.toThrow();
  });

  it.each(['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'])(
    'refuse une configuration sans %s',
    (key) => {
      expect(() => validateEnv({ ...db, [key]: '' })).toThrow(
        new RegExp(`absentes ou vides.*${key}`),
      );
    },
  );

  it.each(['0', '70000', 'abc', '5432.5'])(
    'refuse un DB_PORT invalide (%s)',
    (port) => {
      expect(() => validateEnv({ ...db, DB_PORT: port })).toThrow(
        /DB_PORT n'est pas un port valide/,
      );
    },
  );

  describe('DATABASE_URL fournie explicitement', () => {
    const url = 'postgresql://user:pwd@ailleurs:5432/managed';

    it('l emporte sur les DB_* (base managee, base de CI)', () => {
      expect(validateEnv({ ...db, DATABASE_URL: url })).toMatchObject({
        DATABASE_URL: url,
      });
    });

    it('dispense des DB_*', () => {
      expect(() => validateEnv({ ...app, DATABASE_URL: url })).not.toThrow();
    });

    it('ne dispense PAS de PORT ni d API_PREFIX', () => {
      expect(() => validateEnv({ DATABASE_URL: url })).toThrow(
        /Variables d'application absentes ou vides : PORT, API_PREFIX, BIND_ADDRESS/,
      );
    });

    it('refuse un protocole qui n est pas PostgreSQL', () => {
      expect(() =>
        validateEnv({ DATABASE_URL: 'mysql://user:p@db:3306/portail' }),
      ).toThrow(/protocole PostgreSQL/);
    });

    it('refuse une URL sans base de donnees', () => {
      expect(() =>
        validateEnv({ DATABASE_URL: 'postgresql://user:p@db:5432' }),
      ).toThrow(/aucune base de donnees/);
    });

    it('refuse une URL sans hote', () => {
      expect(() =>
        validateEnv({ DATABASE_URL: 'postgresql:///portail' }),
      ).toThrow(/aucun hote/);
    });
  });

  describe('PORT et API_PREFIX', () => {
    it('expose PORT comme un nombre, pret pour app.listen', () => {
      expect(validateEnv({ ...db })).toMatchObject({ PORT: 21610 });
    });

    it('expose BIND_ADDRESS, sans quoi l API ecouterait sur 0.0.0.0', () => {
      // app.listen(port) sans adresse ecoute sur toutes les interfaces. Sur la
      // machine de staging, partagee avec d'autres candidats, cela rendrait
      // l'API joignable en contournant le proxy.
      expect(validateEnv({ ...db })).toMatchObject({
        BIND_ADDRESS: '127.0.0.1',
      });
    });

    it.each(['PORT', 'API_PREFIX', 'BIND_ADDRESS'])(
      'refuse une configuration sans %s',
      (key) => {
        // Aucune valeur par defaut : sur une machine partagee, une API qui
        // ecoute au mauvais endroit est pire qu'une API qui ne demarre pas.
        expect(() => validateEnv({ ...db, [key]: '' })).toThrow(
          new RegExp(`Variables d'application absentes ou vides.*${key}`),
        );
      },
    );

    it.each(['0', '70000', 'abc', '3000.5'])(
      'refuse un PORT invalide (%s)',
      (port) => {
        expect(() => validateEnv({ ...db, PORT: port })).toThrow(
          /PORT n'est pas un port valide/,
        );
      },
    );

    it.each(['api/v1', '/api/v1/', 'https://ailleurs/api'])(
      'refuse un API_PREFIX mal forme (%s)',
      (prefix) => {
        expect(() => validateEnv({ ...db, API_PREFIX: prefix })).toThrow(
          /API_PREFIX doit commencer par/,
        );
      },
    );

    it('accepte « / », qui signifie « pas de prefixe »', () => {
      expect(() => validateEnv({ ...db, API_PREFIX: '/' })).not.toThrow();
    });
  });

  it('ne recopie jamais un secret dans le message d erreur', () => {
    expect(() =>
      validateEnv({
        ...db,
        DB_PORT: '',
        DB_PASSWORD: 'MotDePasseTresSecret',
        JWT_SECRET: 'SecretDeJetonTresSecret',
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringMatching(/TresSecret/) as string,
      }) as Error,
    );
  });
});
