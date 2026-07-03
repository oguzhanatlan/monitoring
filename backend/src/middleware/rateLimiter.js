import rateLimit from 'express-rate-limit';

// Katman 1 — sıkı: login, setup, TOTP doğrulama gibi brute-force hedefi endpoint'ler.
// Başarılı istekler sayılmaz; 15 dakikada 5 başarısız deneme sonrası 429 döner.
export const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Çok fazla başarısız deneme. 15 dakika sonra tekrar deneyin.' },
});

// Katman 2 — hafif: yıkıcı işlemler (kullanıcı silme, dosya silme/taşıma, process kill).
// Meşru kullanımı engellemez, script'lenmiş kötüye kullanımı yavaşlatır.
export const destructiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Çok fazla istek. Lütfen biraz bekleyin.' },
});

// Katman 3 — genel: tüm API için cömert üst sınır.
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'İstek limiti aşıldı. Lütfen biraz bekleyin.' },
});
