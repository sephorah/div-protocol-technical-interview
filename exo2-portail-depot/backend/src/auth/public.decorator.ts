import { SetMetadata } from '@nestjs/common';

/**
 * A symbol, not the string 'isPublic': metadata keys share one namespace, and
 * a string that common would let any library -- or any future decorator of ours
 * -- open a route by accident. A symbol cannot collide.
 */
export const IS_PUBLIC_KEY = Symbol('auth:isPublic');

/**
 * Opens a route to unauthenticated callers.
 *
 * The guard is global (see AuthModule), so every route is protected by default
 * and this decorator is the only way out. That direction is deliberate: with
 * the opposite convention -- a guard added route by route -- a forgotten
 * decorator publishes a route silently, whereas a forgotten @Public() produces
 * an immediate, visible 401.
 *
 * Its consumers: the login and logout routes, the health probe, and every
 * /public/* route of the client side (C1, C2), which is anonymous by design.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
