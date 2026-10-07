import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getMe, loginOwner, logoutOwner, putAccount, setOnOwnerUnauthorized, setOwnerToken, type AccountChange, type OwnerUser } from '../services/api'

// Owner session for the Admin Station. The JWT lives in sessionStorage, so it survives a page
// reload but is gone once the app window closes.

const TOKEN_KEY = 'pos9010.ownerToken'
export const LAST_USERNAME_KEY = 'pos9010.lastOwnerUsername'

interface AuthValue {
  status: 'checking' | 'signed_out' | 'signed_in'
  user: OwnerUser | null
  login: (username: string, pin: string) => Promise<void>
  /** First launch: creates the owner account and signs in. */
  /** Changes the signed-in owner's username, name and PIN (Settings → My account). */
  updateAccount: (change: AccountChange) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // storage unavailable: the session just won't survive a reload
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthValue['status']>('checking')
  const [user, setUser] = useState<OwnerUser | null>(null)

  const clear = useCallback(() => {
    writeToken(null)
    setOwnerToken(null)
    setUser(null)
    setStatus('signed_out')
  }, [])

  useEffect(() => {
    setOnOwnerUnauthorized(clear)
    const token = readToken()
    if (!token) {
      setStatus('signed_out')
      return
    }
    getMe(token)
      .then((me) => {
        setOwnerToken(token)
        setUser(me)
        setStatus('signed_in')
      })
      .catch(clear)
    return () => setOnOwnerUnauthorized(null)
  }, [clear])

  const signedIn = useCallback((result: { token: string; user: OwnerUser }) => {
    writeToken(result.token)
    setOwnerToken(result.token)
    setUser(result.user)
    setStatus('signed_in')
    // The sign-in screen offers the last username used on this PC instead of assuming one.
    try { if (result.user.username) localStorage.setItem(LAST_USERNAME_KEY, result.user.username) } catch { /* not remembered */ }
  }, [])

  const login = useCallback(async (username: string, pin: string) => signedIn(await loginOwner(username, pin)), [signedIn])
  const updateAccount = useCallback(async (change: AccountChange) => {
    const updated = await putAccount(change)
    setUser(updated)
    try { if (updated.username) localStorage.setItem(LAST_USERNAME_KEY, updated.username) } catch { /* not remembered */ }
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutOwner()
    } catch {
      // already invalid or server unreachable: sign out locally anyway
    }
    clear()
  }, [clear])

  const value = useMemo(() => ({ status, user, login, updateAccount, logout }), [status, user, login, updateAccount, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
