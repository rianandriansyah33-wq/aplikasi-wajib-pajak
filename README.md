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

## Reminder WhatsApp

Sebelum memakai fitur reminder pertama kali, jalankan [supabase-reminder-migration.sql](supabase-reminder-migration.sql) melalui Supabase `SQL Editor`. Riwayat reminder disimpan per nopol dan disinkronkan antar perangkat.

Tombol WhatsApp membuka template reminder berikutnya, sedangkan tombol `Tandai #...` dipakai setelah pesan benar-benar dikirim. Penandaan sengaja dipisah agar membuka WhatsApp tanpa mengirim pesan tidak menaikkan hitungan reminder. Template ke-2 sampai ke-10 memakai narasi layanan e-Samsat Jatim tanpa gambar maupun tautan eksternal.

## Detail kendaraan SIAPP

Data seperti nomor HP, jenis kendaraan, merk/tipe, tahun/warna, masa STNK, PKB, opsen, dan jumlah memang tidak selalu tersedia pada tabel Buku Produksi. SIAPP menyediakan detail tersebut melalui Status SPOS, NPP, dan NTP, tetapi endpointnya menerima satu nopol per permintaan. Aplikasi membuat proses itu berjalan otomatis secara bertahap tanpa memasukkan nopol satu per satu.

1. Jalankan [supabase-vehicle-detail-migration.sql](supabase-vehicle-detail-migration.sql) sekali melalui Supabase `SQL Editor`.
2. Buka menu `SIAPP` aplikasi, pilih `Kartu follow-up` atau `Semua nopol Buku Produksi` pada Target Detail Otomatis, lalu pasang bookmark `Tarik Detail Otomatis`. Pasang ulang bookmark bila target diubah.
3. Buka halaman SIAPP mana pun yang sudah login, lalu klik bookmark tersebut. Konfirmasi jumlah nopol yang akan diproses.
4. Biarkan tab SIAPP terbuka sampai notifikasi menyatakan selesai. Bila tab berhenti atau koneksi putus, jalankan bookmark kembali; nopol dengan detail yang sudah tersimpan akan dilewati.
5. Buka detail kartu nopol di aplikasi. Bagian `Detail Kendaraan SIAPP` akan menampilkan data yang tersimpan beserta sumber statusnya. Nomor kartu follow-up yang masih kosong juga otomatis diisi dari nomor HP SIAPP; nomor yang telah diisi sebelumnya tidak ditimpa.

Target `Kartu follow-up` cocok untuk melengkapi kartu yang sedang dikelola. Target `Semua nopol Buku Produksi` mencakup seluruh riwayat yang tersimpan dan dapat membutuhkan waktu lebih lama karena SIAPP tidak menyediakan endpoint detail massal.

Untuk satu nopol yang sedang dibuka di `SPOS`, `NPP`, atau `NTP` > `Status`, bookmark `Simpan Detail Status SIAPP` masih dapat digunakan.

Bookmark ini menyimpan nomor HP SIAPP untuk follow-up. Email dan NIK dari formulir Status SIAPP tidak disimpan.

Jika penarikan berhenti dengan `404 ceknorek.php`, unggah versi terbaru `siapp-vehicle-detail.js`. Versi terbaru membaca tautan menu Status serta alamat detail/HP dari skrip halaman tersebut, mempertahankan folder URL relatif, dan tidak memakai permintaan `ceknorek.php` sebagai syarat. Bookmark memuat skrip dengan parameter waktu setiap kali dijalankan, sehingga tidak perlu memasang ulang bookmark apabila alamat hosting dan targetnya tetap sama. Perbaikan ini tidak memerlukan migrasi SQL tambahan.

Pengujian regresi memakai respons SIAPP dan Supabase simulasi: jalankan `node tests/siapp-vehicle-detail.test.cjs` dengan modul `playwright` dan Chrome tersedia. Pengujian ini tidak membaca atau mengubah database SIAPP/Supabase asli.

## Migrasi penuh dari Google Sheet

Sebelum menghapus Google Sheet, ekspor kedua tab berikut satu per satu dari Google Sheet: pilih tab, lalu `File` > `Download` > `Comma-separated values (.csv, current sheet)`.

1. Tab `BUKU_PRODUKSI` untuk seluruh riwayat SIAPP.
2. Tab `DATA_WAJIB_PAJAK` untuk kartu follow-up dan hasil dinas luar.

Setelah Supabase siap dan aplikasi versi terbaru sudah diunggah ke GitHub Pages, buka aplikasi lalu gunakan tombol `Import Data` untuk memilih kedua CSV tersebut satu per satu. Data akan digabung dan dikirim bertahap ke Supabase tanpa menghapus data yang sudah ada. Periksa jumlah data pada dashboard dan lakukan satu kali Sinkron Lengkap SIAPP sebelum menghapus Google Sheet.

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
6. Data nopol dan status bayar akan dikirim ke tabel Buku Produksi Supabase. Gunakan `Sinkron Periode` bila perlu membaca riwayat tertentu, misalnya Juli 2025: bookmark akan memeriksa SPOS, NPP, NTP, dan seluruh halaman hanya untuk bulan tersebut. Setelah pemindaian awal selesai, gunakan `Perbarui Semua Cepat` untuk membaca ulang seluruh periode yang sudah ada di database beserta seluruh halamannya, tanpa mencoba bulan/tahun kosong. Gunakan `Sinkron Lengkap` untuk pemindaian awal atau bila perlu mencari periode lama yang belum pernah tersimpan. `Pantau Otomatis` juga membaca ulang semua periode yang masih belum lunas saat pertama dijalankan dan setiap 30 menit berikutnya.

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
