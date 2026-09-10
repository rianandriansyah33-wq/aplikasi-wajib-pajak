# Aplikasi Follow-up Wajib Pajak Kendaraan

Buka `index.html` di browser untuk memakai aplikasi.

Data utama aplikasi disimpan di Supabase. Data lokal browser hanya dipakai sebagai cache sementara ketika koneksi terputus.

## Buka dari HP lewat internet

Cara paling sederhana:

1. Upload folder `aplikasi-wajib-pajak` ke GitHub Pages.
2. Setelah upload selesai, hosting akan memberi link website.
3. Buka link tersebut dari HP.

Catatan penting: jika `config.js` belum diisi, data aplikasi tetap tersimpan lokal di browser masing-masing perangkat.

## Setup Supabase

Aplikasi ini memakai Supabase sebagai database online agar input, penghapusan, dan pembaruan status dapat tersinkron antar perangkat.

Sebelum membuka aplikasi pertama kali:

1. Buka Supabase > `SQL Editor` > `New query`.
2. Tempel seluruh isi `supabase-schema.sql`, lalu klik `Run`.
3. Upload ulang file aplikasi ke GitHub Pages.
4. Buka ulang aplikasi. Tidak ada proses masuk memakai email.

Data laptop dan HP akan memakai database Supabase yang sama. Aplikasi tidak lagi memerlukan Google Sheet atau Apps Script.

## Migrasi penuh dari Google Sheet

Sebelum menghapus Google Sheet, buka aplikasi lama pada browser yang biasa dipakai lalu tekan tombol `JSON`. Berkas cadangan baru berisi data wajib pajak dan Buku Produksi SIAPP.

Setelah Supabase siap dan aplikasi versi terbaru sudah diunggah ke GitHub Pages, buka aplikasi lalu gunakan tombol `Import` untuk memilih berkas JSON tersebut. Data akan dikirim ke Supabase. Periksa jumlah data pada dashboard dan lakukan satu kali Sinkron Lengkap SIAPP sebelum menghapus Google Sheet.

Aplikasi juga akan mencoba memindahkan data lokal yang sudah tersimpan di browser ke Supabase saat pertama kali terhubung. Data yang lebih baru di Supabase tidak akan ditimpa oleh data cache yang lebih lama.

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

Catatan keamanan: karena aplikasi dibuka tanpa login email, jangan bagikan link aplikasi ke umum jika data berisi nama dan nomor WhatsApp wajib pajak.
