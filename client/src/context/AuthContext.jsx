import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import api from '../services/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    api.get('/auth/me')
      .then(({ data }) => { if (active) setUser(data.user) })
      .catch(() => { if (active) setUser(null) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const value = useMemo(() => ({
    user,
    loading,
    async login(credentials) {
      const { data } = await api.post('/auth/login', credentials)
      setUser(data.user)
      return data.user
    },
    async registerStudent(values) {
      const { data } = await api.post('/auth/register', values)
      setUser(data.user)
      return data.user
    },
    async logout() {
      await api.post('/auth/logout')
      setUser(null)
    },
    refresh: async () => {
      const { data } = await api.get('/auth/me')
      setUser(data.user)
      return data.user
    },
  }), [user, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
