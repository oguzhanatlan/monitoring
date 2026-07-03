import { Router } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import multer from 'multer';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { resolveSafePath, getAllowedRoots, PathError } from '../utils/pathValidator.js';
import { audit } from '../utils/audit.js';
import { destructiveLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// PathError'ı 403'e çeviren küçük sarmalayıcı
function safe(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      if (err instanceof PathError) return res.status(err.statusCode).json({ error: err.message });
      next(err);
    }
  };
}

// Metin olarak düzenlenmesine izin verilen maksimum dosya boyutu (2 MB)
const MAX_TEXT_SIZE = 2 * 1024 * 1024;

router.get('/roots', (req, res) => {
  res.json({ roots: getAllowedRoots() });
});

// Klasör içeriği listeleme
router.get(
  '/',
  safe(async (req, res) => {
    const dir = resolveSafePath(req.query.path);
    const stat = await fsp.stat(dir);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Bu bir klasör değil' });

    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (e) => {
        const full = path.join(dir, e.name);
        try {
          const s = await fsp.lstat(full);
          return {
            name: e.name,
            path: full,
            isDir: e.isDirectory(),
            isSymlink: e.isSymbolicLink(),
            size: s.size,
            mode: (s.mode & 0o777).toString(8),
            mtime: s.mtime.toISOString(),
          };
        } catch {
          return { name: e.name, path: full, isDir: e.isDirectory(), size: 0, mode: '000', mtime: null, error: true };
        }
      })
    );
    items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    res.json({ path: dir, parent: path.dirname(dir), items });
  })
);

// Dosya içeriğini oku (metin düzenleme için)
router.get(
  '/content',
  safe(async (req, res) => {
    const file = resolveSafePath(req.query.path);
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return res.status(400).json({ error: 'Bu bir dosya değil' });
    if (stat.size > MAX_TEXT_SIZE) {
      return res.status(413).json({ error: 'Dosya düzenleme için çok büyük (>2 MB)' });
    }
    const content = await fsp.readFile(file, 'utf8');
    res.json({ path: file, content });
  })
);

// Dosya içeriğini kaydet
router.put(
  '/content',
  safe(async (req, res) => {
    const file = resolveSafePath(req.body?.path);
    const content = req.body?.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'İçerik metin olmalı' });
    await fsp.writeFile(file, content, 'utf8');
    audit(req.user, 'files.save', file, req.ip);
    res.json({ ok: true });
  })
);

// Dosya indir
router.get(
  '/download',
  safe(async (req, res) => {
    const file = resolveSafePath(req.query.path);
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return res.status(400).json({ error: 'Sadece dosya indirilebilir' });
    audit(req.user, 'files.download', file, req.ip);
    res.download(file, path.basename(file));
  })
);

// Klasörü zip olarak indir
router.get(
  '/download-zip',
  safe(async (req, res) => {
    const dir = resolveSafePath(req.query.path);
    const stat = await fsp.stat(dir);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Sadece klasör zip\'lenebilir' });
    audit(req.user, 'files.download_zip', dir, req.ip);
    res.attachment(`${path.basename(dir) || 'archive'}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', () => res.destroy());
    archive.pipe(res);
    archive.directory(dir, false);
    archive.finalize();
  })
);

// Yükleme: hedef klasör query'de path olarak gelir; multer önce temp'e yazar
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 1024 * 1024 * 1024 } });
router.post(
  '/upload',
  upload.array('files', 20),
  safe(async (req, res) => {
    const dir = resolveSafePath(req.query.path);
    const results = [];
    for (const f of req.files || []) {
      const dest = resolveSafePath(path.join(dir, path.basename(f.originalname)));
      await fsp.rename(f.path, dest).catch(async () => {
        // Farklı dosya sistemleri arası rename başarısız olursa kopyala+sil
        await fsp.copyFile(f.path, dest);
        await fsp.unlink(f.path);
      });
      results.push(path.basename(dest));
      audit(req.user, 'files.upload', dest, req.ip);
    }
    res.json({ ok: true, uploaded: results });
  })
);

// Yeni klasör oluştur
router.post(
  '/mkdir',
  safe(async (req, res) => {
    const dir = resolveSafePath(req.body?.path);
    await fsp.mkdir(dir, { recursive: false });
    audit(req.user, 'files.mkdir', dir, req.ip);
    res.status(201).json({ ok: true });
  })
);

// Yeni boş dosya oluştur
router.post(
  '/touch',
  safe(async (req, res) => {
    const file = resolveSafePath(req.body?.path);
    const fh = await fsp.open(file, 'wx'); // varsa hata verir
    await fh.close();
    audit(req.user, 'files.create', file, req.ip);
    res.status(201).json({ ok: true });
  })
);

// Yeniden adlandır / taşı (kaynak ve hedef ayrı doğrulanır)
router.post(
  '/rename',
  safe(async (req, res) => {
    const from = resolveSafePath(req.body?.from);
    const to = resolveSafePath(req.body?.to);
    await fsp.rename(from, to);
    audit(req.user, 'files.rename', `${from} -> ${to}`, req.ip);
    res.json({ ok: true });
  })
);

// Kopyala
router.post(
  '/copy',
  safe(async (req, res) => {
    const from = resolveSafePath(req.body?.from);
    const to = resolveSafePath(req.body?.to);
    await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    audit(req.user, 'files.copy', `${from} -> ${to}`, req.ip);
    res.json({ ok: true });
  })
);

// Zip arşivi aç (hedef klasöre)
router.post(
  '/unzip',
  safe(async (req, res) => {
    const zipPath = resolveSafePath(req.body?.path);
    const stat = await fsp.stat(zipPath);
    if (!stat.isFile()) return res.status(400).json({ error: 'Geçerli bir zip dosyası değil' });
    const destDir = resolveSafePath(req.body?.dest || path.dirname(zipPath));

    const zip = new AdmZip(zipPath);
    // Zip-slip koruması: her girdinin hedefi destDir içinde kalmalı
    for (const entry of zip.getEntries()) {
      const target = resolveSafePath(path.join(destDir, entry.entryName));
      if (!target.startsWith(destDir + path.sep) && target !== destDir) {
        return res.status(400).json({ error: 'Zip güvenli olmayan yol içeriyor' });
      }
    }
    zip.extractAllTo(destDir, /* overwrite */ true);
    audit(req.user, 'files.unzip', `${zipPath} -> ${destDir}`, req.ip);
    res.json({ ok: true });
  })
);

// Silme — tekil veya çoklu (paths dizisi). Yıkıcı işlem: rate limit + audit
router.delete(
  '/',
  destructiveLimiter,
  safe(async (req, res) => {
    const raw = req.body?.paths || (req.query.path ? [req.query.path] : []);
    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({ error: 'Silinecek yol belirtilmedi' });
    }
    const deleted = [];
    for (const p of raw) {
      const target = resolveSafePath(p);
      // Bir kökün kendisini silmeyi engelle
      if (getAllowedRoots().includes(target)) {
        return res.status(400).json({ error: 'Kök dizin silinemez' });
      }
      await fsp.rm(target, { recursive: true, force: false });
      deleted.push(target);
      audit(req.user, 'files.delete', target, req.ip);
    }
    res.json({ ok: true, deleted });
  })
);

// fs hatalarını okunur mesajlara çevir
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const map = {
    ENOENT: [404, 'Dosya veya klasör bulunamadı'],
    EEXIST: [409, 'Bu isimde bir dosya/klasör zaten var'],
    EACCES: [403, 'İşletim sistemi izni reddedildi'],
    EPERM: [403, 'İşletim sistemi izni reddedildi'],
    ENOTEMPTY: [400, 'Klasör boş değil'],
  };
  const entry = map[err.code];
  if (entry) return res.status(entry[0]).json({ error: entry[1] });
  console.error('Dosya işlemi hatası:', err);
  res.status(500).json({ error: 'Beklenmeyen bir hata oluştu' });
});

export default router;
