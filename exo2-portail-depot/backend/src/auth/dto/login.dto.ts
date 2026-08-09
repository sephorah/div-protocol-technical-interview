import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The login route's body.
 *
 * The global ValidationPipe (main.ts) runs with `whitelist` and
 * `forbidNonWhitelisted`, so anything not declared here is rejected with a 400
 * rather than silently dropped.
 */
export class LoginDto {
  // 320 characters is the maximum length of an address per RFC 5321 (64 for the
  // local part, 255 for the domain, plus the @). Bounded for the same reason as
  // the password below, and to the same end: nothing anonymous should be able
  // to hand the server an unbounded string.
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(320)
  email!: string;

  /**
   * Only bounded, never checked for shape: a password policy on the LOGIN route
   * would reject an existing password that no longer matches the current rules,
   * and would leak the rules themselves.
   *
   * The upper bound is the point of interest. argon2id's cost grows with the
   * input, so an unbounded field lets an anonymous caller ask for the hashing
   * of a megabyte -- an amplification attack that costs the sender nothing.
   * 200 characters is far above any real passphrase.
   */
  @IsString()
  @MinLength(1, { message: 'Le mot de passe est obligatoire.' })
  @MaxLength(200)
  password!: string;
}
