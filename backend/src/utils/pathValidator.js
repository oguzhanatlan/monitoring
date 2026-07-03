import path from 'node:path';
import fs from 'node:fs';
import config from '../config/config.js';

// Path traversal korumasının tek geçiş noktası. Kullanıcıdan gelen HER path
// buradan geçmeli. İzin verilen köklerin (ALLOWED_ROOTS) dışına çıkan hiçbir
// yola izin verilmez.
//
// Yaklaşım:
//  1. Girdiyi mutlak yola çözümle (path.resolve ".." bileşenlerini normalize eder)
//  2. Sembolik linklerin köklerden kaçmasını engellemek için gerçek yolu (realpath)
//     kontrol et — mevcutsa gerçek yol, değilse en yakın var olan atası doğrulanır
//  3. Sonucun izin verilen köklerden birinin İÇİNDE olduğunu segment sınırında doğrula

export class PathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathError';
    this.statusCode = 403;
  }
}

function isInsideRoot(resolved, root) {
  // Segment sınırı kontrolü: "/var/www2" değeri "/var/www" kökünü geçmiş sayılmamalı
  return resolved === root || resolved.startsWith(root + path.sep);
}

// Var olan en yakın atanın gerçek yolunu döndürür; symlink kaçışlarını yakalamak için
function realpathOfNearestExisting(absPath) {
  let current = absPath;
  while (true) {
    try {
      const real = fs.realpathSync(current);
      // current, absPath'in kendisiyse doğrudan; ata ise absPath'in kalanını ekle
      if (current === absPath) return real;
      const rest = path.relative(current, absPath);
      return path.join(real, rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absPath; // kök dahil hiçbiri yok
      current = parent;
    }
  }
}

/**
 * Kullanıcı path'ini doğrular ve güvenli mutlak yolu döndürür.
 * @param {string} inputPath - istemciden gelen ham yol
 * @returns {string} izin verilen kök içinde, çözümlenmiş mutlak yol
 * @throws {PathError} yol izin verilen kökler dışındaysa
 */
export function resolveSafePath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new PathError('Yol belirtilmedi');
  }
  // NUL bayt enjeksiyonu
  if (inputPath.includes('\0')) {
    throw new PathError('Geçersiz yol');
  }

  const resolved = path.resolve(inputPath);
  const realResolved = realpathOfNearestExisting(resolved);

  const allowed = config.allowedRoots.some(
    (root) => isInsideRoot(resolved, root) && isInsideRoot(realResolved, root)
  );

  if (!allowed) {
    throw new PathError('Bu yola erişim izni yok');
  }
  return resolved;
}

// İzin verilen köklerin listesi (frontend başlangıç noktalarını göstersin diye)
export function getAllowedRoots() {
  return config.allowedRoots;
}
