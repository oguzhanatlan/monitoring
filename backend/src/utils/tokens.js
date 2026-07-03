import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import db from '../db/database.js';
import config from '../config/config.js';

const REFRESH_COOKIE = 'refresh_token';
// Cookie sadece auth endpoint'lerine gider (refresh/logout) — başka hiçbir istekte taşınmaz
const REFRESH_COOKIE_PATH = '/api/auth';

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtAccessTtl,
  });
}

// TOTP bekleyen ara aşama için kısa ömürlü token (tam yetki VERMEZ — authMiddleware reddeder)
export function signTotpStageToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, stage: 'totp' }, config.jwtSecret, {
    expiresIn: '2m',
  });
}

export function verifyTotpStageToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  if (payload.stage !== 'totp') throw new Error('Beklenen ara aşama token\'ı değil');
  return { id: payload.sub, username: payload.username };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Yeni refresh token üretir, hash'ini DB'ye yazar ve httpOnly cookie olarak set eder.
// Token'ın kendisi asla saklanmaz, response body'ye de yazılmaz.
export function issueRefreshToken(res, user) {
  const token = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date(Date.now() + config.refreshTtlDays * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
  ).run(user.id, hashToken(token), expiresAt.toISOString());

  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: config.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

// Cookie'deki refresh token'ı doğrular ve DÖNDÜRMEDEN ÖNCE İPTAL EDER (rotation:
// her refresh token tek kullanımlıktır). Geçerliyse kullanıcıyı döndürür.
export function consumeRefreshToken(req) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT rt.id, rt.expires_at, u.id AS user_id, u.username
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = ?`
    )
    .get(hashToken(token));

  if (!row) return null;
  db.prepare(`DELETE FROM refresh_tokens WHERE id = ?`).run(row.id);
  if (new Date(row.expires_at) < new Date()) return null;

  return { id: row.user_id, username: row.username };
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}

// Süresi geçmiş token'ları periyodik temizle (her saat)
export function startRefreshTokenCleanup() {
  const cleanup = () =>
    db.prepare(`DELETE FROM refresh_tokens WHERE expires_at < datetime('now')`).run();
  cleanup();
  setInterval(cleanup, 60 * 60 * 1000).unref();
}
