import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The login route's body. The global ValidationPipe rejects anything not
 * declared here with a 400 rather than dropping it silently.
 *
 * BOTH fields are length-bounded, and that is the security-relevant part:
 * argon2id's cost grows with its input, so on a route that is anonymous and
 * deliberately not rate-limited, an unbounded field lets anyone ask the server
 * to hash a megabyte. 320 is the RFC 5321 maximum for an address; 200 is far
 * above any real passphrase.
 */
export class LoginDto {
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(320)
  email!: string;

  // No shape policy: on the LOGIN route it would reject an existing password
  // that predates the current rules, and leak the rules along the way.
  @IsString()
  @MinLength(1, { message: 'Le mot de passe est obligatoire.' })
  @MaxLength(200)
  password!: string;
}
