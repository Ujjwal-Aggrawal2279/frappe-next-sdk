'use client'

import {
  createContext, useContext, useEffect,
  useState, type ReactNode,
} from 'react'
import type { BootData } from '../types'

interface FrappeNextCtx extends BootData { hydrated: boolean }

const Ctx = createContext<FrappeNextCtx>({
  csrfToken: 'fetch',
  siteName:  '',
  user:      null,
  hydrated:  false,
})

export function FrappeNextProvider({
  csrfToken, siteName, user, children,
}: BootData & { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // Inject for frappeClientPost CSRF reads + legacy frappe-react-sdk compat
    ;(window as typeof window & { csrf_token: string }).csrf_token = csrfToken
    setHydrated(true)
  }, [csrfToken])

  return (
    <Ctx.Provider value={{ csrfToken, siteName, user, hydrated }}>
      {children}
    </Ctx.Provider>
  )
}

export function useFrappeNext(): FrappeNextCtx {
  return useContext(Ctx)
}
