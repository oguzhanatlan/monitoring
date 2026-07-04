import { useEffect, useState, useCallback } from 'react';
import api from '../api/client.js';
import { useAuth } from '../AuthContext.jsx';
import Modal from '../components/Modal.jsx';

export default function Users() {
  const { user: me, logout } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Modal durumları
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '' });
  const [addError, setAddError] = useState('');

  const [resetTarget, setResetTarget] = useState(null); // şifresi sıfırlanacak kullanıcı
  const [resetPass, setResetPass] = useState('');
  const [resetError, setResetError] = useState('');

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

  function openAddModal() {
    setNewUser({ username: '', password: '' });
    setAddError('');
    setShowAddModal(true);
  }

  async function addUser(e) {
    e.preventDefault();
    setAddError('');
    try {
      await api.post('/users', newUser);
      setNewUser({ username: '', password: '' });
      setShowAddModal(false);
      setNotice('Kullanıcı eklendi.');
      load();
    } catch (err) {
      setAddError(err.response?.data?.error || 'Kullanıcı eklenemedi');
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

  function openResetModal(u) {
    setResetTarget(u);
    setResetPass('');
    setResetError('');
  }

  async function submitReset(e) {
    e.preventDefault();
    setResetError('');
    try {
      await api.put(`/users/${resetTarget.id}/password`, { password: resetPass });
      const isSelf = resetTarget.id === me.id;
      setResetTarget(null);
      setResetPass('');
      if (isSelf) {
        // Kendi şifresini değiştirince tüm oturumlar iptal olur → yeniden giriş
        logout();
      } else {
        setNotice('Şifre güncellendi.');
      }
    } catch (err) {
      setResetError(err.response?.data?.error || 'Şifre değiştirilemedi');
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
      {notice && <p className="notice">{notice}</p>}

      <section className="card">
        <div className="card-head">
          <h3>Hesaplar</h3>
          <button onClick={openAddModal}>+ Yeni kullanıcı</button>
        </div>
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
                <td>
                  <span className={`badge-status ${u.totp_enabled ? 'active' : 'warn'}`}>
                    {u.totp_enabled ? 'Açık' : 'Kapalı'}
                  </span>
                </td>
                <td className="dim small">{u.created_at}</td>
                <td className="dim small">{u.last_login || '—'}</td>
                <td className="row-actions">
                  <button className="ghost" onClick={() => openResetModal(u)}>
                    Şifre sıfırla
                  </button>
                  <button className="danger" onClick={() => removeUser(u)}>
                    Sil
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

      {showAddModal && (
        <Modal title="Yeni kullanıcı ekle" onClose={() => setShowAddModal(false)}>
          <form className="modal-form" onSubmit={addUser}>
            <label>
              Kullanıcı adı
              <input
                autoFocus
                placeholder="ör. deploy"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
              />
            </label>
            <label>
              Şifre (en az 8 karakter)
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              />
            </label>
            {addError && <p className="error">{addError}</p>}
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setShowAddModal(false)}>
                Vazgeç
              </button>
              <button type="submit">Ekle</button>
            </div>
          </form>
        </Modal>
      )}

      {resetTarget && (
        <Modal
          title={`Şifre sıfırla — ${resetTarget.username}`}
          onClose={() => setResetTarget(null)}
        >
          <form className="modal-form" onSubmit={submitReset}>
            {resetTarget.id === me.id && (
              <p className="dim">
                Kendi şifrenizi değiştiriyorsunuz; kaydettikten sonra yeniden giriş yapmanız
                gerekecek.
              </p>
            )}
            <label>
              Yeni şifre (en az 8 karakter)
              <input
                autoFocus
                type="password"
                value={resetPass}
                onChange={(e) => setResetPass(e.target.value)}
              />
            </label>
            {resetError && <p className="error">{resetError}</p>}
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setResetTarget(null)}>
                Vazgeç
              </button>
              <button type="submit">Kaydet</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
