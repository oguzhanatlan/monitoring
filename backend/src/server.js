import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Server as SocketServer } from 'socket.io';

import config from './config/config.js';
import './db/database.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import { authMiddleware } from './middleware/authMiddleware.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { startRefreshTokenCleanup } from './utils/tokens.js';

const app = express();

app.set('trust proxy', 1); // Nginx arkasında gerçek istemci IP'si için

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      // origin'siz istekler (curl, aynı origin) ve izinli origin'ler kabul edilir
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error('CORS: bu origin\'e izin verilmiyor'));
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

startRefreshTokenCleanup();

const httpServer = http.createServer(app);

// Socket.io: /ws path'i üzerinden, /system ve /terminal namespace'leri sonraki fazlarda eklenecek
export const io = new SocketServer(httpServer, {
  path: '/ws',
  cors: { origin: config.corsOrigins, credentials: true },
});

httpServer.listen(config.port, config.host, () => {
  console.log(`Panel backend ${config.host}:${config.port} adresinde çalışıyor`);
});
