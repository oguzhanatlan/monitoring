# Sunucu Yönetim Paneli

Ubuntu sunucu için tarayıcıdan erişilen yönetim paneli: **canlı sistem izleme**, **dosya yöneticisi** ve **web terminal**. Node.js + Express backend, React (Vite) frontend, SQLite veritabanı.

> ⚠️ Bu panel dosya sistemine ve terminale erişim verdiği için **root/admin erişimiyle eşdeğerdir**. İnternete açıksa HTTPS + güçlü şifre + 2FA (ve tercihen IP kısıtlaması) zorunludur.

## Özellikler

- **Sistem izleme:** CPU (yük, çekirdek başına, load average, sıcaklık), RAM/swap, disk doluluk + I/O, ağ hızları, uptime, process listesi (sonlandırma), servis durumu — hepsi WebSocket ile canlı.
- **Dosya yöneticisi:** listeleme, kod editörü (CodeMirror), yükleme (drag&drop), indirme, zip indir/aç, mkdir, yeniden adlandır/taşı, kopyala, çoklu silme — path traversal korumalı.
- **Web terminal:** gerçek `/bin/bash` oturumu (node-pty), çoklu sekme, xterm.js.
- **Kullanıcı yönetimi:** çoklu kullanıcı (eşit yetki), 2FA (TOTP), audit log.

## Güvenlik

- Şifreler `bcrypt` (12 tur) ile hashlenir; ilk kurulumda belirlenir, hardcoded şifre yok.
- JWT access token (15 dk) + **httpOnly cookie**'de saklanan rotating refresh token (7 gün). Access token frontend'de yalnızca bellekte tutulur (localStorage yok).
- TOTP tabanlı 2FA (Google Authenticator uyumlu), kullanıcı bazında.
- 3 katmanlı rate limiting: login/setup/2FA (15dk/5), yıkıcı işlemler (dk/30), genel (dk/300).
- WebSocket bağlantıları (metrik + terminal) handshake'te JWT ile doğrulanır.
- Dosya yöneticisinde `resolveSafePath` ile path traversal + symlink kaçışı + zip-slip koruması.
- CORS yalnızca panel domaini, `helmet` güvenlik başlıkları, tüm hassas işlemler audit loglu.

## Proje yapısı

```
backend/    Express API + Socket.io + SQLite (frontend/dist'i de sunar)
frontend/   Vite + React arayüz
nginx/      Örnek reverse proxy config (SSL + WS)
deploy/     systemd service dosyası
```

## Geliştirme (lokal)

WSL/Linux gereklidir (`node-pty` ve `better-sqlite3` native derlenir).

```bash
# Backend
cd backend
cp .env.example .env         # JWT_SECRET'ı doldurun: openssl rand -hex 64
npm install
npm run dev                  # http://127.0.0.1:3000

# Frontend (ayrı terminalde)
cd frontend
npm install
npm run dev                  # http://127.0.0.1:5173 (API'yi 3000'e proxy'ler)
```

İlk açılışta panel setup ekranı gösterir; ilk yönetici hesabını oluşturun.

## Üretim Deployment (Ubuntu sunucu)

> Aşağıdaki adımlar sunucuda **elle** çalıştırılır. Panel `panel.turkiyemcepte.com` içindir.

### 1. Sınırlı yetkili kullanıcı oluştur (terminal riskini azaltır)

```bash
sudo adduser --system --group --shell /bin/bash --home /home/panel panel
# Terminalde sudo gerekiyorsa sınırlı bir sudoers kuralı ekleyin (isteğe bağlı).
```

### 2. Node.js 22 kur

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3
```

### 3. Kodu sunucuya kopyala ve derle

```bash
sudo mkdir -p /opt/server-panel
sudo chown -R panel:panel /opt/server-panel
# Bu depoyu /opt/server-panel içine kopyalayın (scp/rsync/git)

cd /opt/server-panel/backend
npm ci --omit=dev
cp .env.example .env
# .env'i düzenleyin (aşağıya bakın)

cd /opt/server-panel/frontend
npm ci
npm run build                # frontend/dist üretir; backend bunu otomatik sunar
```

### 4. `.env` ayarları (backend/.env)

```
PORT=3000
HOST=127.0.0.1               # SADECE localhost — dışarı Nginx üzerinden açılır
NODE_ENV=production
JWT_SECRET=<openssl rand -hex 64 çıktısı>
CORS_ORIGIN=https://panel.turkiyemcepte.com
ALLOWED_ROOTS=/home,/var/www # dosya yöneticisinin gezebileceği kökler
TERMINAL_SHELL=/bin/bash
MONITORED_SERVICES=nginx,mysql,docker
```

### 5. systemd servisi

```bash
sudo cp /opt/server-panel/deploy/server-panel.service /etc/systemd/system/
# Dosyadaki User/Group/WorkingDirectory alanlarını doğrulayın
sudo systemctl daemon-reload
sudo systemctl enable --now server-panel
sudo systemctl status server-panel
```

### 6. Nginx + SSL

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp /opt/server-panel/nginx/server-panel.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/server-panel.conf /etc/nginx/sites-enabled/

# SSL sertifikası al (DNS A kaydı sunucuya işaret etmeli)
sudo certbot --nginx -d panel.turkiyemcepte.com

sudo nginx -t && sudo systemctl reload nginx
```

### 7. Firewall (UFW) — backend portunu dışarı kapat

```bash
sudo ufw allow 'Nginx Full'   # 80 + 443
sudo ufw allow OpenSSH
sudo ufw deny 3000            # backend yalnızca localhost'tan Nginx'e açık
sudo ufw enable
sudo ufw status
```

Panel artık `https://panel.turkiyemcepte.com` adresinde. İlk ziyarette setup ekranından yönetici hesabını oluşturun ve hemen **2FA'yı etkinleştirin** (Kullanıcılar sayfası).

## Güncelleme

```bash
cd /opt/server-panel && git pull      # veya yeni dosyaları kopyalayın
cd backend && npm ci --omit=dev
cd ../frontend && npm ci && npm run build
sudo systemctl restart server-panel
```
