import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../AuthContext.jsx';

export default function Login() {
  const { applyLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpToken, setTotpToken] = useState(null); // doluysa 2FA kod adımındayız
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitPassword(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await axios.post(
        '/api/auth/login',
        { username, password },
        { withCredentials: true }
      );
      if (res.data.totpRequired) {
        setTotpToken(res.data.totpToken);
      } else {
        applyLogin(res.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Giriş başarısız');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await axios.post(
        '/api/auth/login/totp',
        { totpToken, code },
        { withCredentials: true }
      );
      applyLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Doğrulama başarısız');
      if (err.response?.status === 401 && /süresi doldu/i.test(err.response?.data?.error || '')) {
        setTotpToken(null); // ara token süresi dolduysa şifre adımına dön
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Sunucu Paneli</h1>
        {totpToken === null ? (
          <form onSubmit={submitPassword}>
            <label>
              Kullanıcı adı
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
              />
            </label>
            <label>
              Şifre
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
          </form>
        ) : (
          <form onSubmit={submitCode}>
            <p>Doğrulama uygulamanızdaki 6 haneli kodu girin.</p>
            <label>
              Doğrulama kodu
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                autoFocus
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button disabled={busy}>{busy ? 'Doğrulanıyor…' : 'Doğrula'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
