# Panduan Deploy Bakso Aci App ke Cloudflare + Bot Telegram

Struktur folder:
```
basoaci-cloudflare/
├── worker/          → Backend API + Bot Telegram (Cloudflare Worker + D1)
└── frontend/        → Aplikasi React (Cloudflare Pages)
```

---

## BAGIAN 1 — Siapkan Bot Telegram

1. Buka Telegram, chat ke **@BotFather**.
2. Kirim `/newbot`, ikuti instruksi (kasih nama & username bot).
3. BotFather akan kasih **Bot Token**, contoh: `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`. Simpan ini.
4. Cari tahu **Chat ID** kamu sendiri (supaya bot tahu ke mana kirim notif):
   - Chat apa saja ke bot kamu (misal ketik `/start`).
   - Buka di browser: `https://api.telegram.org/bot<TOKEN>/getUpdates` (ganti `<TOKEN>` dengan token kamu).
   - Cari `"chat":{"id": ...}` di hasil JSON — angka itu Chat ID kamu.

---

## BAGIAN 2 — Deploy Backend (Cloudflare Worker + D1)

### 2.1 Install Wrangler CLI
```bash
npm install -g wrangler
wrangler login
```
Ini akan buka browser untuk login ke akun Cloudflare kamu.

### 2.2 Buat database D1
```bash
cd worker
wrangler d1 create basoaci-db
```
Perintah ini akan menampilkan output berisi `database_id`. **Copy `database_id` itu**, lalu buka `wrangler.toml` dan ganti:
```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```
dengan ID yang kamu dapat.

### 2.3 Jalankan migrasi (bikin tabel)
```bash
npm run migrate:remote
```
Ini akan membuat semua tabel (menu, orders, shop_info, testimonials) di database cloud kamu, sekaligus mengisi menu default.

### 2.4 Set secrets (jangan taruh di kode!)
```bash
wrangler secret put ADMIN_PIN
# masukkan PIN admin kamu, misal: 542103jkl

wrangler secret put TELEGRAM_BOT_TOKEN
# masukkan token dari BotFather

wrangler secret put TELEGRAM_CHAT_ID
# masukkan Chat ID kamu dari langkah 1.4

wrangler secret put TELEGRAM_WEBHOOK_SECRET
# buat string acak sendiri, misal: rahasia123webhook
```

### 2.5 Deploy Worker
```bash
npm run deploy
```
Setelah selesai, Wrangler akan menampilkan URL Worker kamu, contoh:
```
https://basoaci-api.namakamu.workers.dev
```
**Catat URL ini** — dipakai di langkah berikutnya.

### 2.6 Daftarkan webhook Telegram
Ganti `<TOKEN>`, `<WORKER_URL>`, dan `<WEBHOOK_SECRET>` sesuai punya kamu, lalu buka URL ini di browser (atau pakai curl):
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>/telegram/webhook&secret_token=<WEBHOOK_SECRET>
```
Contoh lengkap:
```
https://api.telegram.org/bot123456:ABC/setWebhook?url=https://basoaci-api.namakamu.workers.dev/telegram/webhook&secret_token=rahasia123webhook
```
Kalau berhasil, akan muncul `{"ok":true,"result":true,"description":"Webhook was set"}`.

Coba chat `/help` ke bot kamu di Telegram — harusnya langsung balas daftar perintah.

---

## BAGIAN 3 — Deploy Frontend (Cloudflare Pages)

### 3.1 Update URL API di frontend
Buka `frontend/src/api.js`, ganti baris:
```js
export const API_BASE = "https://basoaci-api.YOUR_SUBDOMAIN.workers.dev";
```
dengan URL Worker asli kamu dari langkah 2.5.

### 3.2 Install dependencies & build
```bash
cd frontend
npm install
npm run build
```
Ini menghasilkan folder `dist/`.

### 3.3 Deploy ke Cloudflare Pages
**Opsi A — via Wrangler (tercepat):**
```bash
npx wrangler pages deploy dist --project-name=basoaci-web
```

**Opsi B — via Dashboard Cloudflare (kalau mau auto-deploy dari GitHub):**
1. Push folder `frontend/` ke repo GitHub.
2. Buka dashboard Cloudflare → Workers & Pages → Create → Pages → Connect to Git.
3. Pilih repo kamu.
4. Build settings:
   - Build command: `npm run build`
   - Build output directory: `dist`
5. Deploy.

Setelah selesai kamu akan dapat URL seperti `https://basoaci-web.pages.dev` — ini yang dibagikan ke pembeli.

---

## BAGIAN 4 — Testing

1. Buka URL Pages kamu, coba pesan sesuatu sebagai pembeli.
2. Setelah konfirmasi "sudah kirim WA", cek Telegram kamu — harus ada notif order baru dengan tombol **Diproses / Selesai / Batalkan**.
3. Coba tap tombol di Telegram → cek di web admin (masuk pakai PIN) apakah status ikut berubah (refresh otomatis tiap 10 detik).
4. Coba command di bot:
   - `/menu` — lihat semua menu & stok
   - `/stok jando 20` — ubah stok
   - `/harga jando 16000` — ubah harga
   - `/pesanan` — lihat order aktif
   - `/cari BAXXXXXX` — cari order tertentu

---

## Catatan Keamanan & Batasan

- PIN admin sekarang divalidasi di server (Worker), tidak lagi kelihatan di source code frontend.
- Session admin (token) berlaku 12 jam, tersimpan di `localStorage` browser.
- Hanya Chat ID yang kamu daftarkan di `TELEGRAM_CHAT_ID` yang bisa kontrol bot — chat lain akan diabaikan diam-diam.
- Cloudflare D1 free tier: 5 juta baca & 100rb tulis per hari — sangat cukup untuk warung skala kecil-menengah.
- Kalau nanti ingin tambah admin lain di Telegram, `TELEGRAM_CHAT_ID` perlu diubah jadi list — kabari saya kalau perlu ini.

---

## Kalau Ada Perubahan Kode di Kemudian Hari

- Ubah backend → edit file di `worker/src/`, lalu `npm run deploy` lagi dari folder `worker/`.
- Ubah tampilan/fitur frontend → edit `frontend/src/BasoAciApp.jsx`, lalu `npm run build` dan deploy ulang ke Pages.
- Ubah schema database → buat file migrasi baru di `worker/migrations/`, lalu `wrangler d1 migrations apply basoaci-db --remote`.
