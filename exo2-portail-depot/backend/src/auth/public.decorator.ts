import { SetMetadata } from '@nestjs/common';

// A symbol, not 'isPublic': metadata keys share one namespace, and a string
// that common could see another library open a route by accident.
export const IS_PUBLIC_KEY = Symbol('auth:isPublic');

/**
 * Opens a route to unauthenticated callers -- the only way out of the global
 * guard. A forgotten @Public() gives a visible 401; the opposite convention
 * publishes a route in silence. The client's /public/* routes (C1, C2) will
 * need it.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
