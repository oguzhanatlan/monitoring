import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Server as SocketServer } from 'socket.io';

import config from './config/config.js';
import './db/database.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import systemRoutes, { registerSystemNamespace } from './routes/system.js';
import fileRoutes from './routes/files.js';
import securityRoutes from './routes/security.js';
import { registerTerminalNamespace } from './routes/terminal.js';
import { authMiddleware, socketAuthMiddleware } from './middleware/authMiddleware.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { startRefreshTokenCleanup } from './utils/tokens.js';

const app = express();

app.set('trust proxy', 1); // Nginx arkasında gerçek istemci IP'si için

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Vite build harici script üretir; xterm/recharts stil enjekte edebilir
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // QR kod data: URL olarak gömülür
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"], // WebSocket dahil aynı origin
        fontSrc: ["'self'", 'data:'],
      },
    },
  })
);
app.use(
  cors({
    origin: (origin, cb) => {
      // origin'siz istekler (curl, aynı origin) ve izinli origin'ler CORS başlığı alır.
      // İzinsiz origin'e başlık EKLENMEZ (hata fırlatmayız): tarayıcı isteği kendi
      // engeller, same-origin ve araç istekleri çalışmaya devam eder.
      cb(null, !origin || config.corsOrigins.includes(origin));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use('/api', generalLimiter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Auth gerektirmeyenler: sadece bu blok (setup/login/refresh kendi limiter'larıyla)
app.use('/api/auth', authRoutes);

// Buradan sonraki TÜM /api rotaları oturum zorunlu
app.use('/api', authMiddleware);
app.use('/api/users', userRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/security', securityRoutes);

// 404 için JSON dön (statik SPA fallback'i yanlışlıkla API'yi yakalamasın)
app.use('/api', (req, res) => res.status(404).json({ error: 'Bulunamadı' }));

// Üretimde derlenmiş frontend'i (frontend/dist) sun; SPA fallback ile
// istemci tarafı yönlendirme çalışsın. Dizin yoksa (geliştirme) atlanır.
const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../frontend/dist'
);
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  console.log('Frontend statik dosyaları sunuluyor:', distDir);
}

startRefreshTokenCleanup();

const httpServer = http.createServer(app);

// Socket.io: /ws path'i üzerinden, /system ve /terminal namespace'leri sonraki fazlarda eklenecek
export const io = new SocketServer(httpServer, {
  path: '/ws',
  cors: { origin: config.corsOrigins, credentials: true },
});

registerSystemNamespace(io, socketAuthMiddleware);
registerTerminalNamespace(io, socketAuthMiddleware);

httpServer.listen(config.port, config.host, () => {
  console.log(`Panel backend ${config.host}:${config.port} adresinde çalışıyor`);
});
