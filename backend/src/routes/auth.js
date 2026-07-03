import { Router } from 'express';
import bcrypt from 'bcrypt';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import db from '../db/database.js';
import { audit } from '../utils/audit.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { strictAuthLimiter } from '../middleware/rateLimiter.js';
import {
  signAccessToken,
  signTotpStageToken,
  verifyTotpStageToken,
  issueRefreshToken,
  consumeRefreshToken,
  clearRefreshCookie,
} from '../utils/tokens.js';

const router = Router();
const BCRYPT_ROUNDS = 12;

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export function validateCredentials(username, password) {
  if (!USERNAME_RE.test(username || '')) {
    return 'Kullanıcı adı 3-32 karakter olmalı; harf, rakam, nokta, alt çizgi ve tire kullanılabilir';
  }
  if (typeof password !== 'string' || password.length < 8) {
    return 'Şifre en az 8 karakter olmalı';
  }
  return null;
}

function userCount() {
  return db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c;
}

function totpInstance(username, secret) {
  return new OTPAuth.TOTP({
    issuer: 'Sunucu Paneli',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

function loginSuccess(res, user, ip) {
  db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id);
  issueRefreshToken(res, user);
  audit(user, 'auth.login', null, ip);
  return res.json({
    accessToken: signAccessToken(user),
    user: { id: user.id, username: user.username },
  });
}

// İlk kurulum durumu — frontend setup mı login mi göstereceğine bununla karar verir
router.get('/setup-status', (req, res) => {
  res.json({ needsSetup: userCount() === 0 });
});

// İlk kurulum: SADECE veritabanında hiç kullanıcı yokken çalışır
router.post('/setup', strictAuthLimiter, async (req, res) => {
  if (userCount() > 0) {
    return res.status(403).json({ error: 'Kurulum zaten tamamlanmış' });
  }
  const { username, password } = req.body || {};
  const validationError = validateCredentials(username, password);
  if (validationError) return res.status(400).json({ error: validationError });

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const info = db
    .prepare(`INSERT INTO users (username, password_hash) VALUES (?, ?)`)
    .run(username, hash);
  const user = { id: info.lastInsertRowid, username };
  audit(user, 'auth.setup', 'İlk yönetici hesabı oluşturuldu', req.ip);
  return loginSuccess(res, user, req.ip);
});

router.post('/login', strictAuthLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const user = db
    .prepare(`SELECT id, username, password_hash, totp_enabled FROM users WHERE username = ?`)
    .get(username || '');

  // Kullanıcı yokken de bcrypt çalıştırılır: yanıt süresi farkından kullanıcı adı sızmasın
  const hash = user?.password_hash || '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const passwordOk = await bcrypt.compare(password || '', hash);

  if (!user || !passwordOk) {
    audit(null, 'auth.login_failed', `Kullanıcı adı: ${username || '(boş)'}`, req.ip);
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
  }

  if (user.totp_enabled) {
    // Şifre doğru ama 2FA açık: tam yetkili token YERİNE 2 dakikalık ara token dönülür
    return res.json({ totpRequired: true, totpToken: signTotpStageToken(user) });
  }
  return loginSuccess(res, user, req.ip);
});

// 2FA'nın ikinci adımı: ara token + 6 haneli kod → tam oturum
router.post('/login/totp', strictAuthLimiter, (req, res) => {
  const { totpToken, code } = req.body || {};
  let stageUser;
  try {
    stageUser = verifyTotpStageToken(totpToken);
  } catch {
    return res.status(401).json({ error: 'Doğrulama süresi doldu, tekrar giriş yapın' });
  }

  const user = db
    .prepare(`SELECT id, username, totp_secret FROM users WHERE id = ? AND totp_enabled = 1`)
    .get(stageUser.id);
  if (!user) return res.status(401).json({ error: 'Geçersiz istek' });

  const valid = totpInstance(user.username, user.totp_secret).validate({
    token: String(code || ''),
    window: 1,
  });
  if (valid === null) {
    audit(user, 'auth.totp_failed', null, req.ip);
    return res.status(401).json({ error: 'Doğrulama kodu hatalı' });
  }
  return loginSuccess(res, user, req.ip);
});

// Access token süresi dolunca httpOnly cookie'deki refresh token ile yenileme.
// Her refresh token tek kullanımlıktır (rotation) — yenisi cookie'ye yazılır.
router.post('/refresh', (req, res) => {
  const user = consumeRefreshToken(req);
  if (!user) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Oturum süresi doldu, tekrar giriş yapın' });
  }
  issueRefreshToken(res, user);
  res.json({
    accessToken: signAccessToken(user),
    user: { id: user.id, username: user.username },
  });
});

router.post('/logout', (req, res) => {
  const user = consumeRefreshToken(req); // token'ı DB'den siler (iptal)
  clearRefreshCookie(res);
  if (user) audit(user, 'auth.logout', null, req.ip);
  res.json({ ok: true });
});

// --- 2FA (TOTP) yönetimi — hepsi oturum gerektirir ---

// Yeni secret üret (henüz aktif değil), QR kod ve elle giriş için secret döner
router.post('/totp/setup', authMiddleware, async (req, res) => {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  db.prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?`).run(
    secret,
    req.user.id
  );
  const uri = totpInstance(req.user.username, secret).toString();
  const qrDataUrl = await QRCode.toDataURL(uri);
  res.json({ secret, qrDataUrl });
});

// Üretilen secret'ı kodla doğrula ve 2FA'yı aktifleştir
router.post('/totp/enable', authMiddleware, strictAuthLimiter, (req, res) => {
  const row = db
    .prepare(`SELECT totp_secret FROM users WHERE id = ? AND totp_secret IS NOT NULL`)
    .get(req.user.id);
  if (!row) return res.status(400).json({ error: 'Önce 2FA kurulumu başlatın' });

  const valid = totpInstance(req.user.username, row.totp_secret).validate({
    token: String(req.body?.code || ''),
    window: 1,
  });
  if (valid === null) return res.status(401).json({ error: 'Doğrulama kodu hatalı' });

  db.prepare(`UPDATE users SET totp_enabled = 1 WHERE id = ?`).run(req.user.id);
  audit(req.user, 'auth.totp_enabled', null, req.ip);
  res.json({ ok: true });
});

// 2FA'yı kapat — şifre doğrulaması ister
router.post('/totp/disable', authMiddleware, strictAuthLimiter, async (req, res) => {
  const row = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.user.id);
  const ok = await bcrypt.compare(req.body?.password || '', row?.password_hash || '');
  if (!ok) return res.status(401).json({ error: 'Şifre hatalı' });

  db.prepare(`UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?`).run(
    req.user.id
  );
  audit(req.user, 'auth.totp_disabled', null, req.ip);
  res.json({ ok: true });
});

// Oturumdaki kullanıcının kendi bilgisi (2FA durumu dahil)
router.get('/me', authMiddleware, (req, res) => {
  const row = db
    .prepare(`SELECT id, username, totp_enabled, created_at, last_login FROM users WHERE id = ?`)
    .get(req.user.id);
  res.json(row);
});

export default router;
