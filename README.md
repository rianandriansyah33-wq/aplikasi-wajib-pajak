# Aplikasi Follow-up Wajib Pajak Kendaraan

Buka `index.html` di browser untuk memakai aplikasi.

Data utama aplikasi disimpan di Supabase. Data lokal browser hanya dipakai sebagai cache sementara ketika koneksi terputus.

## Buka dari HP lewat internet

Cara paling sederhana:

1. Upload folder `aplikasi-wajib-pajak` atau file ZIP aplikasi ini ke hosting statis seperti Netlify.
2. Setelah upload selesai, hosting akan memberi link website.
3. Buka link tersebut dari HP.

Catatan penting: jika `config.js` belum diisi, data aplikasi tetap tersimpan lokal di browser masing-masing perangkat.

## Setup Supabase

Aplikasi ini memakai Supabase sebagai database online agar input, penghapusan, dan pembaruan status dapat tersinkron antar perangkat.

Sebelum membuka aplikasi pertama kali:

1. Buka Supabase > `SQL Editor` > `New query`.
2. Tempel seluruh isi `supabase-schema.sql`, lalu klik `Run`.
3. Buka `Authentication` > `URL Configuration`, lalu masukkan alamat aplikasi GitHub Pages sebagai `Redirect URL`.
4. Upload ulang file aplikasi ke GitHub Pages.
5. Saat aplikasi dibuka, masukkan email pemilik dan tekan `Kirim Tautan Masuk`.

Setelah tautan masuk dibuka dari email, data laptop dan HP memakai database Supabase yang sama.

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
6. Data nopol dan status bayar akan dikirim ke tabel Buku Produksi Supabase.

Cara ini tidak menyimpan username atau password SIAPP di aplikasi.

Jika SIAPP menampilkan link halaman `1 2 3` di bawah tabel, bookmark akan mencoba membaca link halaman yang terlihat sekaligus. Jika hanya muncul tombol `1`, berarti filter yang sedang dibuka hanya punya satu halaman.

Setelah data SIAPP tersinkron, setiap kartu wajib pajak punya tombol `Cek SIAPP`. Tombol ini mengecek nopol pada data `BUKU_PRODUKSI`; jika terdeteksi lunas, status kartu diperbarui menjadi `Sudah bayar`.

### Cara tempel manual

1. Buka Buku Produksi di SIAPP.
2. Blok tabel yang tampil, lalu copy.
3. Di aplikasi, buka menu `Produksi` atau `Buku Produksi`.
4. Pilih jenis buku, bulan, dan tahun.
5. Tempel data tabel tadi, lalu klik `Simpan Referensi`.

Aplikasi menyimpan referensi pada tabel `production_records`, lalu memakainya untuk mengecek nopol secara otomatis.

Catatan keamanan: jangan bagikan link aplikasi ke umum jika data berisi nama dan nomor WhatsApp wajib pajak.
