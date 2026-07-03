import { Router } from 'express';
import bcrypt from 'bcrypt';
import db from '../db/database.js';
import { audit } from '../utils/audit.js';
import { destructiveLimiter } from '../middleware/rateLimiter.js';
import { validateCredentials } from './auth.js';

// Not: Spec gereği rol/izin ayrımı YOK — giriş yapmış her kullanıcı
// listeleme, ekleme, silme ve şifre değiştirme yapabilir.
const router = Router();
const BCRYPT_ROUNDS = 12;

router.get('/', (req, res) => {
  const users = db
    .prepare(`SELECT id, username, totp_enabled, created_at, last_login FROM users ORDER BY id`)
    .all();
  res.json(users);
});

router.post('/', async (req, res) => {
  const { username, password } = req.body || {};
  const validationError = validateCredentials(username, password);
  if (validationError) return res.status(400).json({ error: validationError });

  const exists = db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username);
  if (exists) return res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı' });

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const info = db
    .prepare(`INSERT INTO users (username, password_hash) VALUES (?, ?)`)
    .run(username, hash);
  audit(req.user, 'users.create', `Yeni kullanıcı: ${username}`, req.ip);
  res.status(201).json({ id: info.lastInsertRowid, username });
});

router.delete('/:id', destructiveLimiter, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare(`SELECT id, username FROM users WHERE id = ?`).get(id);
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

  // Son kullanıcı silinemez: aksi halde kullanıcı sayısı 0'a düşer ve
  // /api/auth/setup yeniden açılır — paneli ele geçirme kapısı olur.
  const count = db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c;
  if (count <= 1) {
    return res.status(400).json({ error: 'Son kullanıcı silinemez' });
  }

  db.prepare(`DELETE FROM users WHERE id = ?`).run(id); // refresh token'lar CASCADE ile silinir
  audit(req.user, 'users.delete', `Silinen kullanıcı: ${target.username} (#${id})`, req.ip);
  res.json({ ok: true, selfDeleted: id === req.user.id });
});

router.put('/:id/password', async (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare(`SELECT id, username FROM users WHERE id = ?`).get(id);
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı' });
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, id);
  // Şifre değişince o kullanıcının tüm oturumları (refresh token'ları) iptal edilir
  db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).run(id);
  audit(req.user, 'users.password_change', `Şifresi değiştirilen: ${target.username} (#${id})`, req.ip);
  res.json({ ok: true });
});

export default router;
