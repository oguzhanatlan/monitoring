import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { useAuth } from '../AuthContext.jsx';

export default function Users() {
  const { user: me, logout } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '' });

  // 2FA kurulum durumu
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState(null); // { secret, qrDataUrl }
  const [totpCode, setTotpCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');

  const load = useCallback(async () => {
    try {
      const [usersRes, meRes] = await Promise.all([api.get('/users'), api.get('/auth/me')]);
      setUsers(usersRes.data);
      setTotpEnabled(!!meRes.data.totp_enabled);
    } catch (err) {
      setError(err.response?.data?.error || 'Kullanıcılar yüklenemedi');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleError(err, fallback) {
    setError(err.response?.data?.error || fallback);
  }

  async function addUser(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users', newUser);
      setNewUser({ username: '', password: '' });
      load();
    } catch (err) {
      handleError(err, 'Kullanıcı eklenemedi');
    }
  }

  async function removeUser(u) {
    if (!confirm(`"${u.username}" kullanıcısı silinsin mi?`)) return;
    setError('');
    try {
      const res = await api.delete(`/users/${u.id}`);
      if (res.data.selfDeleted) return logout();
      load();
    } catch (err) {
      handleError(err, 'Kullanıcı silinemedi');
    }
  }

  async function resetPassword(u) {
    const password = prompt(`"${u.username}" için yeni şifre (en az 8 karakter):`);
    if (!password) return;
    setError('');
    try {
      await api.put(`/users/${u.id}/password`, { password });
      if (u.id === me.id) {
        alert('Şifreniz değişti, yeniden giriş yapmanız gerekiyor.');
        logout();
      } else {
        alert('Şifre güncellendi.');
      }
    } catch (err) {
      handleError(err, 'Şifre değiştirilemedi');
    }
  }

  async function startTotpSetup() {
    setError('');
    try {
      const res = await api.post('/auth/totp/setup');
      setTotpSetup(res.data);
    } catch (err) {
      handleError(err, '2FA kurulumu başlatılamadı');
    }
  }

  async function enableTotp(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/totp/enable', { code: totpCode });
      setTotpSetup(null);
      setTotpCode('');
      setTotpEnabled(true);
      load();
    } catch (err) {
      handleError(err, '2FA aktifleştirilemedi');
    }
  }

  async function disableTotp(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/totp/disable', { password: disablePassword });
      setDisablePassword('');
      setTotpEnabled(false);
      load();
    } catch (err) {
      handleError(err, '2FA kapatılamadı');
    }
  }

  return (
    <div className="page">
      <h2>Kullanıcılar</h2>
      {error && <p className="error">{error}</p>}

      <table className="data-table">
        <thead>
          <tr>
            <th>Kullanıcı adı</th>
            <th>2FA</th>
            <th>Oluşturulma</th>
            <th>Son giriş</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                {u.username}
                {u.id === me.id && <span className="badge">siz</span>}
              </td>
              <td>{u.totp_enabled ? 'Açık' : 'Kapalı'}</td>
              <td>{u.created_at}</td>
              <td>{u.last_login || '—'}</td>
              <td className="row-actions">
                <button onClick={() => resetPassword(u)}>Şifre sıfırla</button>
                <button className="danger" onClick={() => removeUser(u)}>
                  Sil
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="panel">
        <h3>Yeni kullanıcı ekle</h3>
        <form className="inline-form" onSubmit={addUser}>
          <input
            placeholder="Kullanıcı adı"
            value={newUser.username}
            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
          />
          <input
            type="password"
            placeholder="Şifre (en az 8 karakter)"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
          />
          <button>Ekle</button>
        </form>
      </section>

      <section className="panel">
        <h3>Hesabım — İki Adımlı Doğrulama (2FA)</h3>
        {totpEnabled ? (
          <form className="inline-form" onSubmit={disableTotp}>
            <p>2FA hesabınızda açık.</p>
            <input
              type="password"
              placeholder="Şifreniz"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
            />
            <button className="danger">2FA'yı kapat</button>
          </form>
        ) : totpSetup ? (
          <div>
            <p>
              QR kodu Google Authenticator (veya uyumlu) uygulamasıyla okutun, ardından üretilen
              kodu girin:
            </p>
            <img src={totpSetup.qrDataUrl} alt="TOTP QR" width={180} />
            <p className="dim">
              Elle giriş için secret: <code>{totpSetup.secret}</code>
            </p>
            <form className="inline-form" onSubmit={enableTotp}>
              <input
                placeholder="6 haneli kod"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
              />
              <button>Doğrula ve aktifleştir</button>
            </form>
          </div>
        ) : (
          <button onClick={startTotpSetup}>2FA kurulumunu başlat</button>
        )}
      </section>
    </div>
  );
}
