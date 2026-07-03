import db from '../db/database.js';

const insertLog = db.prepare(
  `INSERT INTO audit_logs (user_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?)`
);

/**
 * Denetim kaydı yazar. Her hassas işlemde çağrılır: kim, ne yaptı, hangi IP'den.
 * @param {{id?: number, username: string}|null} user - işlemi yapan kullanıcı (login öncesi denemelerde null olabilir)
 * @param {string} action - kısa eylem kodu, örn. 'auth.login', 'files.delete', 'terminal.open'
 * @param {string} [detail] - eylemin hedefi/ayrıntısı, örn. silinen dosyanın yolu
 * @param {string} [ip]
 */
export function audit(user, action, detail = null, ip = null) {
  try {
    insertLog.run(user?.id ?? null, user?.username ?? 'anonymous', action, detail, ip);
  } catch (err) {
    // Denetim kaydı başarısız olsa bile ana işlemi engellemeyelim, sadece loglayalım
    console.error('Audit log yazılamadı:', err.message);
  }
}
