# Panduan Deploy dari Termux (HP Android)

Node & npm kamu sudah ada, jadi langsung ke penyesuaian khusus Termux.

## 0. Persiapan Termux

```bash
pkg update && pkg upgrade
pkg install git unzip nano -y
```

Pastikan Termux bisa akses penyimpanan HP (buat extract zip nanti):
```bash
termux-setup-storage
```

## 1. Pindahkan project ke Termux

Kalau file `basoaci-cloudflare.zip` ada di folder Download HP:
```bash
cd ~
cp /sdcard/Download/basoaci-cloudflare.zip .
unzip basoaci-cloudflare.zip
cd basoaci-cloudflare
```

## 2. Install Wrangler CLI

```bash
npm install -g wrangler
```

Kalau muncul error permission atau gagal compile (beberapa versi wrangler butuh native binding yang kadang rewel di Termux), pakai cara alternatif tanpa install global — pakai `npx` langsung tiap kali (tidak perlu install global):
```bash
npx wrangler --version
```
Kalau ini berhasil menampilkan versi, kamu **tidak perlu** `npm install -g wrangler` — cukup ganti semua perintah `wrangler ...` di panduan jadi `npx wrangler ...`.

## 3. Login ke Cloudflare

```bash
npx wrangler login
```

**Penting untuk Termux/HP:** perintah ini mencoba membuka browser otomatis untuk OAuth. Di Termux biasanya browser tidak otomatis kebuka. Kalau begitu:
1. Wrangler akan print sebuah URL di terminal.
2. Copy URL itu manual (tap-hold untuk select, atau `termux-clipboard-set` kalau mau).
3. Paste URL ke Chrome/browser HP kamu, login, izinkan akses.
4. Setelah browser bilang berhasil, kembali ke Termux — biasanya otomatis terdeteksi. Kalau tidak, tekan Enter di Termux.

Jika tetap gagal (banyak kasus di Android), pakai cara **API Token** sebagai alternatif:
```bash
export CLOUDFLARE_API_TOKEN=xxxxx
```
Buat token di: https://dash.cloudflare.com/profile/api-tokens → "Create Token" → pakai template "Edit Cloudflare Workers". Simpan token itu, lalu jalankan export di atas sebelum perintah wrangler lainnya. Supaya permanen, taruh di `~/.bashrc`:
```bash
echo 'export CLOUDFLARE_API_TOKEN=xxxxx' >> ~/.bashrc
source ~/.bashrc
```

## 4. Deploy Backend (Worker + D1)

```bash
cd worker
npx wrangler d1 create basoaci-db
```
Copy `database_id` yang muncul, edit `wrangler.toml`:
```bash
nano wrangler.toml
```
Ganti `REPLACE_WITH_YOUR_D1_DATABASE_ID` dengan ID asli. Simpan: `Ctrl+O`, Enter, lalu `Ctrl+X` untuk keluar.

```bash
npx wrangler d1 migrations apply basoaci-db --remote
```

Set secrets (bot token, PIN, dll — sama seperti panduan sebelumnya):
```bash
npx wrangler secret put ADMIN_PIN
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Deploy:
```bash
npx wrangler deploy
```

Catat URL Worker yang muncul (`https://basoaci-api.xxx.workers.dev`).

## 5. Daftarkan Webhook Telegram

Pakai `curl` (biasanya sudah ada di Termux, kalau belum: `pkg install curl`):
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>/telegram/webhook&secret_token=<WEBHOOK_SECRET>"
```

## 6. Deploy Frontend

```bash
cd ../frontend
```

Edit dulu `src/api.js`:
```bash
nano src/api.js
```
Ganti `API_BASE` dengan URL Worker kamu. Simpan (`Ctrl+O`, Enter, `Ctrl+X`).

Install & build:
```bash
npm install
npm run build
```

**Catatan Termux:** `npm install` untuk Vite+React di HP bisa lumayan lama dan makan RAM. Kalau HP kena `Killed` atau proses mati sendiri saat build:
```bash
npm install --no-optional
NODE_OPTIONS=--max-old-space-size=1024 npm run build
```
Kalau tetap gagal karena RAM HP terbatas, opsi paling aman: build di komputer/laptop teman sekali saja, lalu upload folder `dist/` hasil build ke Termux (atau langsung deploy dari sana), karena `wrangler pages deploy` cuma butuh folder `dist` jadi, tidak perlu proses build ulang di HP.

Deploy ke Pages:
```bash
npx wrangler pages deploy dist --project-name=basoaci-web
```

## Tips tambahan khusus HP

- Pakai Termux dalam mode landscape atau sambungkan keyboard bluetooth kalau banyak ngetik.
- Install Termux:API (`pkg install termux-api`) kalau mau copy-paste lebih gampang antar app.
- Simpan sesi kerja: jangan sampai Termux di-kill Android saat proses `npm install`/`build` — buka pengaturan baterai HP, kasih pengecualian "no battery restriction" untuk Termux.
- Kalau koneksi HP kamu sering putus saat proses panjang (login OAuth, build), pertimbangkan pakai Wi-Fi yang stabil.
