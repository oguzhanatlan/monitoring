import { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../AuthContext.jsx';

// İlk kurulum: veritabanında hiç kullanıcı yokken ilk yönetici hesabını oluşturur
export default function Setup({ onDone }) {
  const { applyLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Şifreler eşleşmiyor');
      return;
    }
    setBusy(true);
    try {
      const res = await axios.post(
        '/api/auth/setup',
        { username, password },
        { withCredentials: true }
      );
      applyLogin(res.data);
      onDone?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Kurulum başarısız');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>İlk Kurulum</h1>
        <p>Panele erişecek ilk yönetici hesabını oluşturun.</p>
        <form onSubmit={submit}>
          <label>
            Kullanıcı adı
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </label>
          <label>
            Şifre (en az 8 karakter)
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Şifre (tekrar)
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button disabled={busy}>{busy ? 'Oluşturuluyor…' : 'Hesabı oluştur'}</button>
        </form>
      </div>
    </div>
  );
}
