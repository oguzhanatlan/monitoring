import { useEffect, useState, useCallback, useRef } from 'react';
import api from '../api/client.js';
import { useAuth } from '../AuthContext.jsx';

function timeAgo(iso) {
  if (!iso) return '—';
  return new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z')).toLocaleString();
}

const ACTION_LABELS = {
  'auth.login': 'Başarılı giriş',
  'auth.login_failed': 'Başarısız giriş',
  'auth.totp_failed': 'Hatalı 2FA kodu',
  'auth.logout': 'Çıkış',
};

const AUDIT_FILTERS = [
  { value: '', label: 'Tümü' },
  { value: 'auth', label: 'Kimlik' },
  { value: 'files', label: 'Dosya' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'users', label: 'Kullanıcı' },
  { value: 'system', label: 'Sistem' },
  { value: 'security', label: 'Güvenlik' },
];

export default function Security() {
  const { user: me, logout } = useAuth();
  const [logins, setLogins] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [ports, setPorts] = useState(null);
  const [firewall, setFirewall] = useState(null);
  const [audit, setAudit] = useState(null);
  const [auditFilter, setAuditFilter] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const loadLive = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.get('/security/sessions'), api.get('/security/ports')]);
      setSessions(s.data);
      setPorts(p.data.ports);
    } catch (err) {
      setError(err.response?.data?.error || 'Güvenlik verileri alınamadı');
    }
  }, []);

  const loadStatic = useCallback(async () => {
    try {
      const [l, f] = await Promise.all([
        api.get('/security/logins', { params: { limit: 50 } }),
        api.get('/security/firewall'),
      ]);
      setLogins(l.data);
      setFirewall(f.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Güvenlik verileri alınamadı');
    }
  }, []);

  const loadAudit = useCallback(async (filter) => {
    try {
      const res = await api.get('/security/audit', { params: { action: filter, limit: 60 } });
      setAudit(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Denetim kaydı alınamadı');
    }
  }, []);

  useEffect(() => {
    loadLive();
    loadStatic();
    // Oturumlar ve portlar için hafif polling (12 sn)
    pollRef.current = setInterval(loadLive, 12000);
    return () => clearInterval(pollRef.current);
  }, [loadLive, loadStatic]);

  useEffect(() => {
    loadAudit(auditFilter);
  }, [auditFilter, loadAudit]);

  async function revokeSession(id) {
    if (!confirm('Bu oturum sonlandırılsın mı? İlgili cihazın girişi çıkış yapar.')) return;
    try {
      await api.delete(`/security/sessions/${id}`);
      // Kendi son aktif oturumumuzu iptal ettiysek çıkış olabiliriz — güvenli tarafta kal
      loadLive();
    } catch (err) {
      setError(err.response?.data?.error || 'Oturum sonlandırılamadı');
    }
  }

  async function revokeAll() {
    if (!confirm('TÜM oturumlar sonlandırılsın mı? Kendiniz dahil herkes yeniden giriş yapmak zorunda kalır.')) return;
    try {
      await api.post('/security/sessions/revoke-all', {});
      logout(); // kendi oturumumuz da iptal edildi
    } catch (err) {
      setError(err.response?.data?.error || 'Oturumlar sonlandırılamadı');
    }
  }

  const failed24h = logins?.summary?.failed24h ?? 0;
  const sessionCount = sessions?.sessions?.length ?? 0;
  const portCount = ports?.length ?? 0;

  return (
    <div className="page">
      <h2>Güvenlik</h2>
      {error && <p className="error">{error}</p>}

      {/* Genel bakış kartları */}
      <div className="stat-cards">
        <div className="stat-card">
          <span className="dim">Başarısız giriş (24s)</span>
          <strong className={failed24h > 0 ? 'text-danger' : ''}>{failed24h}</strong>
        </div>
        <div className="stat-card">
          <span className="dim">Aktif oturum</span>
          <strong>{sessionCount}</strong>
        </div>
        <div className="stat-card">
          <span className="dim">Açık port</span>
          <strong>{portCount}</strong>
        </div>
        <div className="stat-card">
          <span className="dim">Firewall (UFW)</span>
          <strong>
            {firewall == null ? (
              '—'
            ) : firewall.available ? (
              <span className="badge-status active">aktif</span>
            ) : (
              <span className="badge-status warn">bilinmiyor</span>
            )}
          </strong>
        </div>
      </div>

      {/* Aktif oturumlar */}
      <section className="card">
        <div className="card-head">
          <h3>Aktif oturumlar</h3>
          <button className="danger" onClick={revokeAll} disabled={sessionCount === 0}>
            Tüm oturumları sonlandır
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Kullanıcı</th>
              <th>Başlangıç</th>
              <th>Bitiş</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(sessions?.sessions || []).map((s) => (
              <tr key={s.id}>
                <td>
                  {s.username}
                  {s.user_id === me.id && <span className="badge">siz</span>}
                </td>
                <td className="dim small">{timeAgo(s.created_at)}</td>
                <td className="dim small">{timeAgo(s.expires_at)}</td>
                <td className="row-actions">
                  <button className="danger" onClick={() => revokeSession(s.id)}>
                    Sonlandır
                  </button>
                </td>
              </tr>
            ))}
            {sessionCount === 0 && (
              <tr>
                <td colSpan={4} className="dim center">
                  Aktif oturum yok
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Giriş geçmişi */}
      <section className="card">
        <div className="card-head">
          <h3>Giriş geçmişi</h3>
        </div>
        {logins?.summary?.failedByIp?.length > 0 && (
          <div className="ip-fail-list">
            <span className="dim small">Başarısız denemeler (IP başına):</span>
            {logins.summary.failedByIp.map((f) => (
              <span key={f.ip} className="ip-chip">
                {f.ip} <b>{f.count}</b>
              </span>
            ))}
          </div>
        )}
        <table className="data-table">
          <thead>
            <tr>
              <th>Durum</th>
              <th>Kullanıcı</th>
              <th>IP</th>
              <th>Zaman</th>
            </tr>
          </thead>
          <tbody>
            {(logins?.events || []).map((e) => {
              const isFail = e.action.includes('failed');
              return (
                <tr key={e.id}>
                  <td>
                    <span className={`badge-status ${isFail ? 'fail' : 'active'}`}>
                      {ACTION_LABELS[e.action] || e.action}
                    </span>
                  </td>
                  <td>{e.detail?.startsWith('Kullanıcı adı') ? e.detail.replace('Kullanıcı adı: ', '') : e.username}</td>
                  <td className="mono small">{e.ip || '—'}</td>
                  <td className="dim small">{timeAgo(e.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Açık portlar */}
      <section className="card">
        <div className="card-head">
          <h3>Açık portlar (dinlenen servisler)</h3>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Port</th>
              <th>Protokol</th>
              <th>Adres</th>
              <th>Process</th>
              <th>PID</th>
            </tr>
          </thead>
          <tbody>
            {(ports || []).map((p, i) => (
              <tr key={`${p.protocol}-${p.address}-${p.port}-${i}`}>
                <td className="mono">{p.port}</td>
                <td>{p.protocol}</td>
                <td className="mono small">{p.address}</td>
                <td>{p.process || '—'}</td>
                <td className="dim">{p.pid || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Firewall */}
      <section className="card">
        <div className="card-head">
          <h3>Firewall (UFW)</h3>
        </div>
        {firewall == null ? (
          <p className="dim">Yükleniyor…</p>
        ) : firewall.available ? (
          <pre className="firewall-output">{firewall.output}</pre>
        ) : (
          <p className="dim">
            UFW durumu okunamıyor: {firewall.reason}
            <br />
            <span className="small">
              Servis durumu: {firewall.serviceActive}. Panelden okumak için servis kullanıcısına
              sudoers ile <code>ufw status</code> izni verebilirsiniz (bkz. README).
            </span>
          </p>
        )}
      </section>

      {/* Audit log görüntüleyici */}
      <section className="card">
        <div className="card-head">
          <h3>Denetim kaydı</h3>
          <div className="segmented">
            {AUDIT_FILTERS.map((f) => (
              <button
                key={f.value}
                className={auditFilter === f.value ? 'active' : ''}
                onClick={() => setAuditFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Eylem</th>
              <th>Kullanıcı</th>
              <th>Ayrıntı</th>
              <th>IP</th>
              <th>Zaman</th>
            </tr>
          </thead>
          <tbody>
            {(audit?.rows || []).map((r) => (
              <tr key={r.id}>
                <td className="mono small">{r.action}</td>
                <td>{r.username}</td>
                <td className="small ellipsis" title={r.detail || ''}>
                  {r.detail || '—'}
                </td>
                <td className="mono small">{r.ip || '—'}</td>
                <td className="dim small">{timeAgo(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {audit && (
          <p className="dim small">
            Toplam {audit.total} kayıt · en son {audit.rows.length} tanesi gösteriliyor
          </p>
        )}
      </section>
    </div>
  );
}
