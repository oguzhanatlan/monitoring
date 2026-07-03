import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import api, { setAccessToken, refreshSession, setSessionExpiredHandler } from './api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // ilk sessiz refresh tamamlanana kadar

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setUser(null);
    });
    // Sayfa yenilendiğinde cookie'deki refresh token ile oturumu sessizce geri al
    refreshSession()
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const applyLogin = useCallback((data) => {
    setAccessToken(data.accessToken);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await axios.post('/api/auth/logout', null, { withCredentials: true });
    } catch {
      // çıkışta hata olsa da yerel oturumu temizle
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, applyLogin, logout, api }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
