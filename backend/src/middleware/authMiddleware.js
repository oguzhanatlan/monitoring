import jwt from 'jsonwebtoken';
import config from '../config/config.js';

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  // Login'in ara aşaması (TOTP bekleyen) tam yetkili token değildir
  if (payload.stage) throw new Error('Ara aşama token\'ı ile API erişimi yapılamaz');
  return { id: payload.sub, username: payload.username };
}

// HTTP istekleri için: Authorization: Bearer <access token>
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Oturum gerekli' });
  }
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Geçersiz veya süresi dolmuş oturum' });
  }
}

// Socket.io bağlantıları için: handshake'te auth.token alanı zorunlu.
// Token yoksa veya geçersizse bağlantı daha kurulmadan reddedilir.
export function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Oturum gerekli'));
  }
  try {
    socket.user = verifyAccessToken(token);
    next();
  } catch {
    next(new Error('Geçersiz veya süresi dolmuş oturum'));
  }
}
