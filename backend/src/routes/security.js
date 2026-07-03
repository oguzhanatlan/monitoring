import { Router } from 'express';
import si from 'systeminformation';
import db from '../db/database.js';
import { audit } from '../utils/audit.js';
import { execSafe } from '../utils/execSafe.js';
import { destructiveLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const LOGIN_ACTIONS = ['auth.login', 'auth.login_failed', 'auth.totp_failed', 'auth.logout'];

// Giriş geçmişi + özet (başarısız denemeler, IP başına sayım, son başarılı giriş)
router.get('/logins', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const placeholders = LOGIN_ACTIONS.map(() => '?').join(',');

  const events = db
    .prepare(
      `SELECT id, username, action, detail, ip, created_at
       FROM audit_logs
       WHERE action IN (${placeholders})
       ORDER BY id DESC LIMIT ?`
    )
    .all(...LOGIN_ACTIONS, limit);

  const failed24h = db
    .prepare(
      `SELECT COUNT(*) AS c FROM audit_logs
       WHERE action IN ('auth.login_failed','auth.totp_failed')
         AND created_at >= datetime('now','-1 day')`
    )
    .get().c;

  const failedByIp = db
    .prepare(
      `SELECT COALESCE(ip,'(bilinmiyor)') AS ip, COUNT(*) AS count
       FROM audit_logs
       WHERE action IN ('auth.login_failed','auth.totp_failed')
       GROUP BY ip ORDER BY count DESC LIMIT 20`
    )
    .all();

  const lastSuccess = db
    .prepare(
      `SELECT username, ip, created_at FROM audit_logs
       WHERE action='auth.login' ORDER BY id DESC LIMIT 1`
    )
    .get();

  res.json({ events, summary: { failed24h, failedByIp, lastSuccess } });
});

// Her kullanıcının son başarılı girişi + son başarısız denemesi
router.get('/last-logins', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.last_login,
        (SELECT created_at FROM audit_logs a
           WHERE a.username = u.username AND a.action IN ('auth.login_failed','auth.totp_failed')
           ORDER BY a.id DESC LIMIT 1) AS last_failed,
        (SELECT ip FROM audit_logs a
           WHERE a.username = u.username AND a.action='auth.login'
           ORDER BY a.id DESC LIMIT 1) AS last_login_ip
       FROM users u ORDER BY u.username`
    )
    .all();
  res.json(rows);
});

// Aktif oturumlar — token/hash ASLA dönmez, sadece meta veri
router.get('/sessions', (req, res) => {
  const sessions = db
    .prepare(
      `SELECT rt.id, rt.user_id, u.username, rt.created_at, rt.expires_at
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.expires_at > datetime('now')
       ORDER BY rt.created_at DESC`
    )
    .all();
  // Mevcut kullanıcının kaç aktif oturumu var (kendi oturumunu vurgulamak için)
  const mineCount = sessions.filter((s) => s.user_id === req.user.id).length;
  res.json({ sessions, currentUserId: req.user.id, mineCount });
});

// Tek oturumu iptal
router.delete('/sessions/:id', destructiveLimiter, (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(
      `SELECT rt.id, u.username FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.id = ?`
    )
    .get(id);
  if (!row) return res.status(404).json({ error: 'Oturum bulunamadı' });

  db.prepare(`DELETE FROM refresh_tokens WHERE id = ?`).run(id);
  audit(req.user, 'security.session_revoke', `Oturum #${id} (${row.username})`, req.ip);
  res.json({ ok: true });
});

// Bir kullanıcının (userId verilirse) veya tüm sistemin oturumlarını iptal
router.post('/sessions/revoke-all', destructiveLimiter, (req, res) => {
  const userId = req.body?.userId ? Number(req.body.userId) : null;
  let info;
  if (userId) {
    info = db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).run(userId);
    audit(req.user, 'security.session_revoke_all', `Kullanıcı #${userId} — ${info.changes} oturum`, req.ip);
  } else {
    info = db.prepare(`DELETE FROM refresh_tokens`).run();
    audit(req.user, 'security.session_revoke_all', `Tüm sistem — ${info.changes} oturum`, req.ip);
  }
  res.json({ ok: true, revoked: info.changes });
});

// Açık (LISTEN) portlar / dinlenen servisler
router.get('/ports', async (req, res) => {
  try {
    const conns = await si.networkConnections();
    const seen = new Set();
    const listening = conns
      .filter((c) => (c.state || '').toUpperCase() === 'LISTEN')
      .map((c) => ({
        protocol: c.protocol,
        address: c.localAddress,
        port: Number(c.localPort),
        pid: c.pid || null,
        process: c.process || '',
      }))
      .filter((c) => {
        const key = `${c.protocol}:${c.address}:${c.port}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.port - b.port);
    res.json({ ports: listening });
  } catch (err) {
    res.status(500).json({ error: 'Port bilgisi alınamadı', detail: err.message });
  }
});

// Firewall (UFW) durumu — non-root serviste yetki yoksa graceful döner
router.get('/firewall', async (req, res) => {
  const active = await execSafe('systemctl', ['is-active', 'ufw']);
  const status = await execSafe('ufw', ['status', 'verbose']);

  if (!status.ok) {
    // Yetki yok / ufw kurulu değil — hata fırlatma, bilgilendir
    const raw = status.error || status.stderr || '';
    let reason;
    if (/ENOENT/i.test(raw)) {
      reason = 'UFW kurulu değil (apt install ufw) veya PATH\'te bulunamadı';
    } else if (/permission|not permitted|root|denied/i.test(raw)) {
      reason = 'Yetki yok: servis kullanıcısı "ufw status" çalıştıramıyor (README\'deki sudoers notuna bakın)';
    } else {
      reason = status.stderr || status.error || 'ufw kullanılamıyor';
    }
    return res.json({
      available: false,
      serviceActive: active.ok ? active.stdout.trim() : 'unknown',
      reason,
    });
  }

  res.json({
    available: true,
    serviceActive: active.ok ? active.stdout.trim() : 'unknown',
    output: status.stdout.trim(),
  });
});

// Genel audit log görüntüleyici — action prefix'e göre filtrelenebilir
router.get('/audit', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const filter = req.query.action;

  let rows;
  if (filter && /^[a-z._]+$/i.test(filter)) {
    rows = db
      .prepare(
        `SELECT id, username, action, detail, ip, created_at FROM audit_logs
         WHERE action LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(`${filter}%`, limit, offset);
  } else {
    rows = db
      .prepare(
        `SELECT id, username, action, detail, ip, created_at FROM audit_logs
         ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset);
  }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs`).get().c;
  res.json({ rows, total, limit, offset });
});

export default router;
