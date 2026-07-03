import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`HATA: ${name} ortam değişkeni tanımlı değil. backend/.env dosyanızı kontrol edin (.env.example'a bakın).`);
    process.exit(1);
  }
  return value;
}

function csv(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '127.0.0.1',
  isProduction: process.env.NODE_ENV === 'production',

  jwtSecret: required('JWT_SECRET'),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '15m',
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS) || 7,

  corsOrigins: csv(process.env.CORS_ORIGIN),

  allowedRoots: csv(process.env.ALLOWED_ROOTS).map((p) => path.resolve(p)),

  terminalShell: process.env.TERMINAL_SHELL || '/bin/bash',

  monitoredServices: csv(process.env.MONITORED_SERVICES),

  dbPath: path.resolve(backendRoot, process.env.DB_PATH || './data/panel.db'),
};

if (config.allowedRoots.length === 0) {
  console.error('HATA: ALLOWED_ROOTS boş olamaz — dosya yöneticisinin erişebileceği en az bir kök dizin tanımlayın.');
  process.exit(1);
}

if (config.jwtSecret.length < 32) {
  console.error('HATA: JWT_SECRET en az 32 karakter olmalı. Üretmek için: openssl rand -hex 64');
  process.exit(1);
}

export default config;
