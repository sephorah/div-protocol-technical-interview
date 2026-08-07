import { validateEnv } from './env.validation';

/**
 * Ces cas sont ceux qui ont motive le remplacement de la regex par un vrai
 * `new URL` : chacun passait l'ancienne validation et echouait plus tard,
 * dans le driver, avec un message sans rapport visible avec la configuration.
 */
describe('validateEnv', () => {
  const valide = 'postgresql://user:motdepasse@db:5432/portail_depot';

  it('accepte une URL PostgreSQL complete', () => {
    expect(validateEnv({ DATABASE_URL: valide })).toMatchObject({
      DATABASE_URL: valide,
    });
  });

  it('accepte le protocole court postgres://', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'postgres://user:p@db:5432/portail' }),
    ).not.toThrow();
  });

  it('preserve les autres variables et supprime les espaces', () => {
    expect(
      validateEnv({ DATABASE_URL: `  ${valide}  `, JWT_SECRET: 'x' }),
    ).toEqual({ DATABASE_URL: valide, JWT_SECRET: 'x' });
  });

  it.each([
    ['absente', undefined],
    ['vide', ''],
    ['blanche', '   '],
  ])('refuse une DATABASE_URL %s', (_cas, valeur) => {
    expect(() => validateEnv({ DATABASE_URL: valeur })).toThrow(
      /absente ou vide/,
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
    // Le cas produit par une DATABASE_URL tronquee : l ancienne regex
    // `^postgres(ql)?:\/\/.+` l acceptait.
    expect(() =>
      validateEnv({ DATABASE_URL: 'postgresql:///portail' }),
    ).toThrow(/aucun hote/);
  });

  it.each(['pa/ss', 'pa#ss', 'pa?ss'])(
    'refuse un mot de passe non encode contenant un caractere reserve (%s)',
    (motDePasse) => {
      // C est ce que produit docker-compose.yml quand POSTGRES_PASSWORD
      // contient un de ces caracteres : l URL devient inanalysable.
      expect(() =>
        validateEnv({
          DATABASE_URL: `postgresql://user:${motDePasse}@db:5432/portail`,
        }),
      ).toThrow(/encode-URL/);
    },
  );

  it('ne recopie jamais la valeur dans le message d erreur', () => {
    const secret = 'mysql://avocat:MotDePasseTresSecret@db:3306/portail';

    expect(() => validateEnv({ DATABASE_URL: secret })).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('MotDePasseTresSecret') as string,
      }) as Error,
    );
  });
});
