# Newsgo di Vercel

Folder ini adalah paket Vercel untuk frontend Newsgo. Homepage dan aset utama
disajikan sebagai file statis. Fungsi serverless Vercel membuat respons XML
sitemap/robots/RSS dari endpoint publik backend, lalu menyesuaikan URL sitemap
ke origin Vercel yang sedang menerima request.

```text
Browser -> domain Vercel -> frontend statis dan fungsi XML Vercel -> backend Bun + Hono
              +-- index.html, frontend-new.js, styles.css, favicon.ico
```

Tidak ada API key di HTML atau JavaScript. Fungsi sitemap hanya membaca
endpoint XML publik backend dan menulis ulang origin backend menjadi origin
Vercel; format sitemap tetap XML.

## Deploy dari dashboard Vercel

1. Push repository ke Git, lalu buat project baru di Vercel.
2. Isi **Root Directory** dengan `FRONTEND-NEWSGO-V2/vercel` jika repository
   berisi folder project ini. Jika folder `vercel` sudah menjadi root repository,
   isi dengan `vercel`.
3. Framework Preset boleh dibiarkan **Other**. Build dan output sudah dibaca
   dari `vercel.json`.
4. Tambahkan environment berikut untuk Production, Preview, dan Development:

   - `NEWSGO_SITE_ORIGIN=https://news.domain-anda.com`
   - `NEWSGO_API_BASE=https://powerhouse.my.id`

5. Deploy, lalu hubungkan custom domain yang sama dengan
   `NEWSGO_SITE_ORIGIN`.

`NEWSGO_SITE_ORIGIN` boleh dikosongkan saat percobaan; build akan memakai URL
deployment Vercel. Untuk produksi dan SEO stabil, gunakan custom domain tetap.

## Deploy dengan Vercel CLI

Salin contoh environment untuk penggunaan lokal:

```powershell
Copy-Item .env.example .env.local
npx vercel dev
```

Untuk deploy produksi:

```powershell
npx vercel --prod
```

Vercel CLI akan meminta pembuatan/link project pada pemakaian pertama. Jangan
commit `.env.local`; file tersebut sudah masuk `.gitignore`.

## Cara kerja aset frontend

Asset frontend sudah disalin ke folder ini, sehingga build tidak mengunduh
asset dari Worker. `config.js` mengarahkan browser ke Worker publik.

File yang dihasilkan ke `dist/`:

- `index.html`
- `frontend-new.js`
- `styles.css`
- `favicon.ico`

## Route yang dipertahankan

| URL publik | Penanganan |
| --- | --- |
| `/` dan `/?db=nama_database` | frontend statis Vercel |
| `/{database}/{slug}` | HTML artikel SEO dari Worker |
| `/article/{database}/{id}` | redirect 301 lama dari Worker |
| `/v1/*` | API Worker secara same-origin |
| `/sitemap.xml`, `/sitemap_index.xml`, `/sitemaps/*` | fungsi XML Vercel, XML backend dengan origin Vercel |
| `/rss.xml`, `/robots.txt` | fungsi XML dan crawler policy Vercel |
| `/health`, `/ready` | pemeriksaan layanan melalui Worker |
| `/{indexnow-key}.txt` | verifikasi IndexNow opsional |

Request selain `GET` dan `HEAD` ditolak oleh proxy Vercel. Proxy hanya menerima
pola route Newsgo, tidak meneruskan cookie/Authorization, tidak menerima URL
tujuan dari pengguna, dan membatasi ukuran respons.

## Pemeriksaan lokal

Tidak ada dependency npm yang perlu di-install untuk build atau pemeriksaan:

```powershell
npm run check
npm run build
```

Setelah deploy, periksa minimal:

```text
https://news.domain-anda.com/
https://news.domain-anda.com/v1/databases
https://news.domain-anda.com/sitemap.xml
https://news.domain-anda.com/robots.txt
https://news.domain-anda.com/{database}/{slug-valid}
```

Untuk artikel, pastikan `View Source` (bukan hanya DOM DevTools) sudah berisi
canonical domain Vercel, judul artikel, Open Graph, dan JSON-LD. Jika masih
menunjuk ke domain `workers.dev`, nilai `PUBLIC_SITE_URL` Worker belum sesuai.
