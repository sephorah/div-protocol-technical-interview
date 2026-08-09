import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useSession } from './session'

export const RequireSession = ({ children }: { children: ReactNode }) => {
  const { status } = useSession()
  // Nothing while the session is still being resolved: redirecting here would
  // bounce an authenticated lawyer to the login screen on every reload.
  if (status === 'loading') return null
  if (status === 'anonymous') return <Navigate to="/login" replace />
  return <>{children}</>
}
