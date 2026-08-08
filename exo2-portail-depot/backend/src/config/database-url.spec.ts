import { buildDatabaseUrl } from './database-url';

describe('buildDatabaseUrl', () => {
  const base = {
    DB_HOST: 'db',
    DB_PORT: 5432,
    DB_USER: 'portail',
    DB_PASSWORD: 'motdepasse',
    DB_NAME: 'portail_depot',
  };

  it('assemble une URL PostgreSQL complete', () => {
    expect(buildDatabaseUrl(base)).toBe(
      'postgresql://portail:motdepasse@db:5432/portail_depot',
    );
  });

  it('accepte un port fourni en chaine', () => {
    expect(buildDatabaseUrl({ ...base, DB_PORT: '21632' })).toContain(
      ':21632/',
    );
  });

  /**
   * Le coeur de la raison d'etre de cette fonction : avec une URL concatenee
   * dans docker-compose.yml, chacun de ces mots de passe produisait une chaine
   * inanalysable et l'API refusait de demarrer.
   */
  it.each([
    'pa/ss',
    'pa#ss',
    'pa?ss',
    'pa%ss',
    'p@ss',
    'pa:ss',
    'mot de passe',
  ])(
    'survit a un mot de passe contenant un caractere reserve (%s)',
    (password) => {
      const url = buildDatabaseUrl({ ...base, DB_PASSWORD: password });

      const parsed = new URL(url);
      expect(parsed.hostname).toBe('db');
      expect(parsed.port).toBe('5432');
      expect(parsed.pathname).toBe('/portail_depot');
      // decodeURIComponent, et non parsed.password : ce dernier reste encode.
      expect(decodeURIComponent(parsed.password)).toBe(password);
    },
  );

  it('echappe aussi l utilisateur et le nom de base', () => {
    const url = buildDatabaseUrl({
      ...base,
      DB_USER: 'a/b',
      DB_NAME: 'base test',
    });

    const parsed = new URL(url);
    expect(decodeURIComponent(parsed.username)).toBe('a/b');
    expect(decodeURIComponent(parsed.pathname)).toBe('/base test');
  });
});
