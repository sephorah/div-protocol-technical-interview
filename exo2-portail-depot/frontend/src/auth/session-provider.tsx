import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { apiRequest } from '../api/client'
import { SessionContext } from './session'
import type { LawyerProfile, SessionState, SessionStatus } from './session'

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [lawyer, setLawyer] = useState<LawyerProfile | null>(null)

  useEffect(() => {
    let active = true
    apiRequest<LawyerProfile>('/auth/me')
      .then((profile) => {
        if (!active) return
        setLawyer(profile)
        setStatus('authenticated')
      })
      // Every failure resolves to "anonymous": a definitive "loading" would
      // show an empty screen and never say why.
      .catch(() => {
        if (!active) return
        setLawyer(null)
        setStatus('anonymous')
      })
    return () => {
      active = false
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const profile = await apiRequest<LawyerProfile>('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    setLawyer(profile)
    setStatus('authenticated')
  }, [])

  const signOut = useCallback(async () => {
    // A refused logout still closes the interface: the opposite leaves a
    // screen that looks signed in with no session behind it.
    await apiRequest<void>('/auth/logout', { method: 'POST' }).catch(() => undefined)
    setLawyer(null)
    setStatus('anonymous')
  }, [])

  const value = useMemo<SessionState>(
    () => ({ status, lawyer, signIn, signOut }),
    [status, lawyer, signIn, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
