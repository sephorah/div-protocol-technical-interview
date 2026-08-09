import { createContext, useContext } from 'react'

// Mirrors LawyerProfile in backend/src/lawyers/lawyer.types.ts. Nothing
// generates it, so a field renamed there has to be renamed here by hand.
export type LawyerProfile = { id: string; name: string; email: string }

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous'

export type SessionState = {
  status: SessionStatus
  lawyer: LawyerProfile | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

// The context and the hook live apart from the provider: a file exporting both
// components and functions breaks fast refresh, which the blocking lint
// reports as react/only-export-components.
export const SessionContext = createContext<SessionState | null>(null)

export const useSession = (): SessionState => {
  const value = useContext(SessionContext)
  if (value === null) {
    throw new Error('useSession must be used inside a SessionProvider')
  }
  return value
}
