import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const db = {
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
      expect(() => validateEnv({ DATABASE_URL: url })).not.toThrow();
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
