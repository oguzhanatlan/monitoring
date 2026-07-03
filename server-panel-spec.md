# Web Tabanlı Sunucu Yönetim Paneli — Proje Spesifikasyonu

## 1. Amaç

Ubuntu sunucu üzerinde çalışan, **sadece tarayıcıdan** (uzak masaüstü/VNC/RDP değil) erişilebilen bir yönetim paneli geliştirilecek. Panel şunları sağlayacak:

1. **Sistem İzleme (Monitoring):** CPU, RAM, disk, network, uptime, çalışan process'ler — canlı/gerçek zamanlı.
2. **Dosya Yöneticisi (File Manager):** Sunucudaki dosyaları görüntüleme, düzenleme, yükleme, indirme, silme, taşıma, klasör oluşturma.
3. **Web Terminal:** Tarayıcı üzerinden gerçek bir bash terminali açıp komut çalıştırabilme (SSH benzeri ama web'de).

Bu panel kişisel/yönetici kullanımı için olacak, bu yüzden **güvenlik kritik önemde** — internete açık olacaksa mutlaka authentication + HTTPS zorunlu.

---

## 2. Teknoloji Yığını (Önerilen)

| Katman | Teknoloji | Neden |
|---|---|---|
| Backend | Node.js + Express | Terminal (node-pty) ve websocket desteği native ve olgun |
| Realtime | Socket.io veya native WebSocket (ws) | Terminal I/O ve canlı metrik akışı için |
| Terminal | `node-pty` + `xterm.js` | Sunucuda gerçek pty process açar, tarayıcıda xterm.js ile render edilir |
| Sistem metrikleri | `systeminformation` (npm) | CPU/RAM/disk/network/process bilgisi tek pakette |
| Frontend | React (Vite) veya basit vanilla JS/HTML | React önerilir, dashboard bileşenleri (grafikler vs.) için daha uygun |
| Grafik/Chart | `recharts` veya `chart.js` | CPU/RAM kullanım grafikleri |
| Auth | JWT + bcrypt (kullanıcı adı/şifre), opsiyonel TOTP (2FA) | Terminal erişimi olduğu için güçlü auth şart |
| Veritabanı | SQLite (`better-sqlite3`) | Kullanıcı hesaplarını tutmak için hafif, dosya tabanlı, ekstra servis kurmaya gerek yok |
| Reverse Proxy | Nginx | SSL termination, subdomain yönlendirme |
| SSL | Let's Encrypt (certbot) | Ücretsiz HTTPS |
| Process Manager | PM2 veya systemd service | Panel'in arka planda sürekli çalışması için |

> Not: Backend dilini PHP ile de yapmak mümkün ama `node-pty` + websocket terminal deneyimi Node.js ekosisteminde çok daha olgun ve stabil. Bu yüzden Node.js öneriliyor. Eğer PHP tercih ediliyorsa terminal kısmı için ayrı bir Node.js mikroservisi (sadece terminal için) kullanılabilir.

---

## 3. Özellik Detayları

### 3.1 Kullanıcı Sistemi

- Birden fazla kullanıcı hesabı olabilir, hepsi **eşit yetkiye** sahiptir (rol/izin ayrımı yok — herkes tüm özelliklere erişebilir).
- Kullanıcılar SQLite veritabanında tutulur: `id, username, password_hash, created_at, last_login`.
- **İlk kurulum:** Panel ilk açıldığında veritabanında hiç kullanıcı yoksa, ilk admin kullanıcısını oluşturmak için bir setup ekranı/endpoint'i çalışmalı (`/api/auth/setup` — sadece kullanıcı sayısı 0 iken erişilebilir).
- Giriş yapmış herhangi bir kullanıcı, panel içinden **yeni kullanıcı ekleyebilir**, **kendi şifresini değiştirebilir**, **başka kullanıcıyı silebilir** (rol ayrımı olmadığı için herkes bu işlemleri yapabilir — bilinçli bir tasarım tercihi, sadece güvenilir/az sayıda kişi için düşünülmüş bir panel).
- Şifreler `bcrypt` ile hashlenip saklanır, asla plain text tutulmaz.
- Kullanıcı yönetimi için basit bir "Kullanıcılar" sayfası: liste, ekle, sil, şifre sıfırla.
- Audit log'da (bkz. Güvenlik bölümü) her işlemin **hangi kullanıcı** tarafından yapıldığı kayıt altına alınmalı — rol ayrımı olmasa da kim ne yaptı takip edilebilsin.

### 3.2 Sistem İzleme (Dashboard Ana Ekranı)

- **CPU:** anlık kullanım %, çekirdek sayısı, model, load average (1/5/15 dk), sıcaklık (varsa `sensors` ile)
- **RAM:** toplam/kullanılan/boş, swap kullanımı
- **Disk:** her mount point için toplam/kullanılan/boş alan, disk I/O (read/write hız)
- **Network:** arayüz bazında upload/download hızı (anlık ve grafik olarak)
- **Uptime:** sunucu ne zamandır açık
- **Process listesi:** en çok CPU/RAM tüketen process'ler, PID, process öldürme (kill) butonu (yetkiye bağlı)
- **Servis durumu (opsiyonel):** nginx, mysql, docker gibi servislerin `systemctl status` durumu
- Veriler WebSocket üzerinden 1-2 saniyede bir push edilmeli (polling değil, canlı akış)

### 3.3 Dosya Yöneticisi

- Klasör ağacı (tree view) ve içerik listeleme (isim, boyut, izinler, değiştirilme tarihi)
- Dosya işlemleri: **görüntüle/düzenle** (metin dosyaları için kod editörü — `Monaco Editor` veya `CodeMirror` önerilir), **yükle** (drag&drop upload), **indir**, **sil**, **yeniden adlandır**, **taşı/kopyala**, **yeni klasör/dosya oluştur**
- Çoklu seçim ve toplu işlem (çoklu silme, sıkıştırma)
- Dosya izinleri (chmod) ve sahiplik (chown) değiştirme (opsiyonel, root yetkisi gerektirir)
- Zip/unzip desteği (opsiyonel)
- **Erişim kısıtlaması:** Kök dizin (root path) config'den ayarlanmalı — panelin hangi dizinlerde geziebileceği sınırlandırılmalı (örn. `/`, `/home`, `/var/www` gibi). Path traversal saldırılarına (`../../etc/passwd`) karşı backend'de mutlaka path validasyonu yapılmalı.

### 3.4 Web Terminal

- `node-pty` ile sunucuda gerçek bir shell process (`/bin/bash`) başlatılır
- `xterm.js` ile tarayıcıda tam terminal emülasyonu (renkler, resize, copy-paste, ctrl+c vs.)
- WebSocket üzerinden stdin/stdout iki yönlü akış
- Birden fazla terminal sekmesi açılabilmeli (tab desteği)
- Terminal oturumu kapanınca process de sonlandırılmalı (zombie process bırakmamak için)
- Hangi kullanıcı/hangi yetkiyle terminal açılacağı config'den belirlenmeli (root ile açmak çok riskli — ayrı, kısıtlı yetkili bir sistem kullanıcısı önerilir)

---

## 4. Güvenlik Gereksinimleri (ÇOK ÖNEMLİ)

Bu panel; dosya sistemine ve terminale erişim verdiği için **root/admin erişimiyle eşdeğerdir**. Aşağıdaki önlemler zorunlu:

1. **Authentication:** Kullanıcı adı + bcrypt ile hashlenmiş şifre. Panel ilk kurulumda admin şifresi belirlenmeli, hardcoded şifre OLMAMALI.
2. **2FA (şiddetle önerilir):** TOTP (Google Authenticator uyumlu) ile ikinci katman doğrulama.
3. **HTTPS zorunlu:** Nginx + Let's Encrypt ile SSL. HTTP isteği HTTPS'e yönlendirilmeli.
4. **Rate limiting:** Login denemelerinde brute-force koruması (örn. `express-rate-limit`).
5. **Session/JWT süresi:** Token'lar kısa ömürlü olmalı, refresh token mekanizması kurulmalı.
6. **IP whitelist (opsiyonel ama önerilir):** Panelin sadece belirli IP'lerden erişilebilir olması Nginx seviyesinde ayarlanabilir.
7. **Firewall:** Panelin çalıştığı port (örn. 3000) dışarıya değil sadece Nginx'e (localhost) açık olmalı; UFW ile 3000 portu dışarıdan kapatılmalı.
8. **Path traversal koruması:** Dosya yöneticisi backend'inde her istekte path'in izin verilen kök dizin dışına çıkmadığından emin olunmalı.
9. **Terminal yetkisi:** Mümkünse root yerine sudo yetkisi sınırlı bir kullanıcı ile terminal açılmalı.
10. **Audit log:** Kim ne zaman giriş yaptı, hangi dosyayı sildi/değiştirdi, terminalde neler çalıştırdı — loglanmalı.
11. **CORS ayarları:** Sadece panelin kendi domain'inden gelen isteklere izin verilmeli.
12. **Environment variables:** Şifre, JWT secret gibi bilgiler `.env` dosyasında tutulmalı, koda gömülmemeli, `.gitignore`'a eklenmeli.

---

## 5. Önerilen Klasör Yapısı

```
server-panel/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── users.js          # kullanıcı ekleme/silme/şifre değiştirme
│   │   │   ├── system.js         # CPU/RAM/disk metrikleri
│   │   │   ├── files.js          # dosya yöneticisi API
│   │   │   └── terminal.js       # websocket terminal handler
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js
│   │   │   └── rateLimiter.js
│   │   ├── utils/
│   │   │   └── pathValidator.js  # path traversal koruması
│   │   ├── config/
│   │   │   └── config.js
│   │   ├── db/
│   │   │   └── database.js       # SQLite bağlantısı ve migration
│   │   └── server.js             # ana giriş noktası
│   ├── data/
│   │   └── panel.db              # SQLite veritabanı dosyası (gitignore'da)
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── FileManager.jsx
│   │   │   ├── Terminal.jsx
│   │   │   ├── Users.jsx         # kullanıcı yönetimi sayfası
│   │   │   └── Login.jsx
│   │   ├── components/
│   │   └── App.jsx
│   └── package.json
├── nginx/
│   └── server-panel.conf         # örnek reverse proxy config
├── deploy/
│   └── server-panel.service      # systemd service dosyası
└── README.md
```

---

## 6. API Uç Noktaları (Taslak)

| Method | Endpoint | Açıklama |
|---|---|---|
| POST | `/api/auth/setup` | İlk kurulumda ilk kullanıcıyı oluştur (sadece 0 kullanıcı varken çalışır) |
| POST | `/api/auth/login` | Giriş, JWT döner |
| POST | `/api/auth/logout` | Çıkış |
| GET | `/api/users` | Tüm kullanıcıları listele (giriş yapmış herkes görebilir) |
| POST | `/api/users` | Yeni kullanıcı ekle |
| DELETE | `/api/users/:id` | Kullanıcı sil |
| PUT | `/api/users/:id/password` | Şifre değiştir |
| GET | `/api/system/stats` | Anlık CPU/RAM/disk/network verisi |
| WS | `/ws/system` | Canlı metrik akışı |
| GET | `/api/files?path=...` | Klasör içeriği listele |
| GET | `/api/files/content?path=...` | Dosya içeriğini oku |
| PUT | `/api/files/content` | Dosya içeriğini kaydet |
| POST | `/api/files/upload` | Dosya yükle |
| DELETE | `/api/files?path=...` | Dosya/klasör sil |
| POST | `/api/files/rename` | Yeniden adlandır |
| POST | `/api/files/mkdir` | Yeni klasör oluştur |
| WS | `/ws/terminal` | Terminal stdin/stdout akışı |

---

## 7. Kurulum & Deployment Adımları (Claude Code'un takip etmesi gereken sıra)

1. Backend ve frontend için ayrı Node.js projeleri oluştur (`npm init`)
2. Backend'e gerekli paketleri kur: `express`, `socket.io` veya `ws`, `node-pty`, `systeminformation`, `jsonwebtoken`, `bcrypt`, `dotenv`, `express-rate-limit`, `multer` (dosya upload için), `better-sqlite3` (kullanıcı veritabanı için)
3. Frontend'i Vite + React ile oluştur, `xterm.js`, `monaco-editor` veya `@uiw/react-codemirror`, `recharts`, `axios`, `socket.io-client` kur
4. SQLite veritabanını kur, `users` tablosunu migration ile oluştur (`id, username, password_hash, created_at, last_login`)
5. Auth sistemini kur: ilk kurulum ekranı (`/api/auth/setup`, veritabanında kullanıcı yoksa ilk kullanıcıyı oluşturur), login endpoint, JWT middleware
6. Kullanıcı yönetimi API'sini yaz (`/api/users` — listele, ekle, sil, şifre değiştir). Rol/izin ayrımı YOK, giriş yapan her kullanıcı tüm bu işlemleri yapabilir.
7. Sistem izleme API'sini `systeminformation` ile yaz, websocket ile periyodik veri gönder
8. Dosya yöneticisi API'sini path validasyonu ile yaz
9. Terminal websocket handler'ını `node-pty` ile yaz, frontend'de `xterm.js` ile bağla
10. Frontend'de dashboard, dosya yöneticisi, terminal, kullanıcılar ve login/setup sayfalarını oluştur
11. Tüm API isteklerine auth middleware ekle (login ve ilk setup hariç)
12. `.env.example` dosyası oluştur, gerçek `.env`'i ve `data/panel.db`'yi `.gitignore`'a ekle
13. Nginx reverse proxy config'i yaz (SSL + websocket upgrade desteği ile)
14. systemd service dosyası yaz, panelin sunucu açılışında otomatik başlamasını sağla
15. UFW ile backend portunu dışarıya kapat, sadece Nginx üzerinden erişime izin ver
16. Test: setup akışı, login, kullanıcı ekleme/silme, dosya CRUD işlemleri, terminal komut çalıştırma, canlı metrik akışını doğrula

---

## 8. Notlar

- Bu panel **internete tamamen açık** bırakılmamalı; en azından güçlü şifre + 2FA + IP kısıtlaması kombinasyonlarından en az ikisi uygulanmalı.
- Rol sistemi bilinçli olarak eklenmedi: tüm kullanıcılar eşit yetkiye sahip (terminal, dosya sistemi, kullanıcı yönetimi dahil). Bu, panelin sadece güvenilen az sayıda kişi (örn. sen ve ekip arkadaşların) tarafından kullanılacağı varsayımına dayanır. İleride ihtiyaç olursa RBAC eklenebilir ama başlangıç kapsamında değil.
- Mobil uyumluluk isteniyorsa frontend responsive tasarlanmalı (özellikle terminal ve dosya yöneticisi için).
