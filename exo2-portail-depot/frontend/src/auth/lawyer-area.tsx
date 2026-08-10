import { Outlet } from 'react-router-dom'
import { SessionProvider } from './session-provider'

/**
 * The lawyer's half of the SPA, and the reason it is a layout route rather than
 * a wrapper around every route: SessionProvider calls /auth/me on mount, so
 * mounting it above the client's deposit screen would make an anonymous
 * visitor's browser probe the lawyer session -- and, on its 401, the refresh
 * route behind it -- on a page whose whole point is that there is no account.
 */
export const LawyerArea = () => (
  <SessionProvider>
    <Outlet />
  </SessionProvider>
)
