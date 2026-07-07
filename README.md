# Aplikasi Follow-up Wajib Pajak Kendaraan

Buka `index.html` di browser untuk memakai aplikasi.

Data dapat disimpan lokal di browser atau disinkronkan ke Google Sheet jika `config.js` sudah diisi dengan URL Google Apps Script.

## Buka dari HP lewat internet

Cara paling sederhana:

1. Upload folder `aplikasi-wajib-pajak` atau file ZIP aplikasi ini ke hosting statis seperti Netlify.
2. Setelah upload selesai, hosting akan memberi link website.
3. Buka link tersebut dari HP.

Catatan penting: jika `config.js` belum diisi, data aplikasi tetap tersimpan lokal di browser masing-masing perangkat.

## Sinkron data laptop dan HP

Aplikasi ini sudah disiapkan untuk memakai Google Sheet sebagai database online.

Langkah setup:

1. Buat Google Sheet baru.
2. Di Google Sheet, buka Extensions > Apps Script.
3. Hapus kode bawaan, lalu tempel isi file `google-apps-script.js`.
4. Klik Save.
5. Klik Deploy > New deployment.
6. Pilih type `Web app`.
7. Pilih `Execute as: Me`.
8. Pilih `Who has access: Anyone`.
9. Klik Deploy, lalu salin Web app URL.
10. Tempel URL tersebut ke `GOOGLE_SCRIPT_URL` di file `config.js`.
11. Upload ulang folder aplikasi ke Netlify.

Setelah `config.js` terisi, data dari laptop dan HP akan memakai Google Sheet yang sama.

Aplikasi akan mengecek Google Sheet otomatis setiap sekitar 10 detik, dan juga langsung mengecek ulang saat tab/browser dibuka kembali. Jadi data dari HP atau laptop lain bisa muncul tanpa refresh manual.

## Aturan surat

Urutan surat mengikuti masa laku pajak:

1. `SPOS` muncul pada H+15.
2. `NPP` muncul pada H+30.
3. `NTP` muncul pada H+60.

Jika nopol yang sama sudah ada di database, aplikasi tidak membuat data baru. Data lama akan diperbarui, dan jenis surat hanya naik mengikuti urutan `SPOS > NPP > NTP`.

## Cek Buku Produksi SIAPP

Ada dua cara untuk memakai data SIAPP sebagai pembanding status nopol.

### Cara otomatis dari halaman SIAPP

1. Buka Buku Produksi di SIAPP.
2. Di aplikasi, buka menu `SIAPP`.
3. Pasang tombol `Sinkron SIAPP` sebagai bookmark Chrome.
4. Saat Buku Produksi SIAPP sedang tampil, klik bookmark `Sinkron SIAPP`.
5. Bookmark akan mencoba membaca menu `SPOS`, `NPP`, `NTP`, seluruh bulan/tahun yang tersedia, dan halaman yang bisa dijangkau.
6. Data nopol dan status bayar akan dikirim ke Google Sheet aplikasi.

Cara ini tidak menyimpan username atau password SIAPP di aplikasi.

Jika SIAPP menampilkan link halaman `1 2 3` di bawah tabel, bookmark akan mencoba membaca link halaman yang terlihat sekaligus. Jika hanya muncul tombol `1`, berarti filter yang sedang dibuka hanya punya satu halaman.

Setelah data SIAPP tersinkron, setiap kartu wajib pajak punya tombol `Cek SIAPP`. Tombol ini mengecek nopol pada data `BUKU_PRODUKSI`; jika terdeteksi lunas, status kartu diperbarui menjadi `Sudah bayar`.

### Cara tempel manual

1. Buka Buku Produksi di SIAPP.
2. Blok tabel yang tampil, lalu copy.
3. Di aplikasi, buka menu `Produksi` atau `Buku Produksi`.
4. Pilih jenis buku, bulan, dan tahun.
5. Tempel data tabel tadi, lalu klik `Simpan Referensi`.

Aplikasi akan membuat sheet tambahan bernama `BUKU_PRODUKSI`. Setelah Apps Script terbaru dideploy ulang, referensi ini ikut sinkron ke HP/laptop dan dipakai untuk mengecek nopol secara otomatis.

Catatan keamanan: jangan bagikan link aplikasi ke umum jika data berisi nama dan nomor WhatsApp wajib pajak.
