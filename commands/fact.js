/**
 * Random Fact Command
 * Dapatkan fakta menarik acak dalam Bahasa Indonesia
 */

const CommandBase = require('./base');

class FactCommand extends CommandBase {
    constructor() {
        super({
            name: 'fact',
            aliases: ['randomfact', 'funfact', 'fakta'],
            description: 'Dapatkan fakta menarik acak',
            usage: '.fact',
            category: 'fun',
            cooldown: 3000
        });

        // Comprehensive facts database in Indonesian
        this.facts = this.buildFactsDatabase();
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '💡');

        try {
            const randomFact = this.facts[Math.floor(Math.random() * this.facts.length)];

            const response = 
`💡 *Fakta Menarik*

${randomFact}

🎲 _Mau lagi? Ketik .fact_`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal menampilkan fakta.');
        }
    }

    buildFactsDatabase() {
        return [
            // === FAKTA SAINS ===
            "Madu tidak pernah basi. Arkeolog menemukan madu berumur 3000 tahun di makam Mesir kuno yang masih bisa dimakan.",
            "Satu hari di Venus lebih panjang dari satu tahunnya. Venus membutuhkan 243 hari Bumi untuk berputar pada porosnya.",
            "Gurita memiliki tiga jantung dan darah berwarna biru.",
            "Pisang secara teknis adalah buah beri, sementara stroberi bukan.",
            "Pohon tertua di dunia berumur lebih dari 5.000 tahun dan berada di California.",
            "Hiu sudah ada di Bumi lebih lama dari pohon. Hiu muncul 400 juta tahun lalu, pohon sekitar 350 juta tahun lalu.",
            "Sambaran petir lima kali lebih panas dari permukaan matahari, mencapai sekitar 30.000 Kelvin.",
            "Otak manusia menggunakan sekitar 20% dari total oksigen dan kalori yang dikonsumsi tubuh.",
            "DNA manusia 99,9% identik dengan DNA manusia lainnya. Hanya 0,1% yang membuatmu unik.",
            "Mata manusia bisa membedakan sekitar 10 juta warna berbeda.",
            "Air panas membeku lebih cepat dari air dingin. Fenomena ini disebut Efek Mpemba.",
            "Sidik jari koala sangat mirip dengan sidik jari manusia, kadang sulit dibedakan di TKP.",
            "Jantung manusia berdetak sekitar 100.000 kali per hari, atau 35 juta kali per tahun.",
            "Kilat bergerak dengan kecepatan 270.000 km/jam dan bisa mencapai 8 km panjangnya.",
            "Satu sendok teh neutron star memiliki berat sekitar 6 miliar ton.",
            "Otak manusia menghasilkan cukup listrik untuk menyalakan lampu LED kecil.",
            "Hujan di Venus terbuat dari asam sulfat, bukan air.",
            "Tubuh manusia mengandung cukup besi untuk membuat paku sepanjang 3 inci.",
            "Bayi memiliki 300 tulang, tetapi orang dewasa hanya memiliki 206 tulang.",
            "Kecoak bisa hidup selama seminggu tanpa kepala sebelum mati kelaparan.",
            
            // === FAKTA HEWAN ===
            "Lumba-lumba tidur dengan satu mata terbuka. Setengah otaknya tetap terjaga.",
            "Lebah madu bisa mengenali wajah manusia.",
            "Burung flamingo berwarna pink karena makanannya, udang dan ganggang.",
            "Gajah adalah satu-satunya hewan yang tidak bisa melompat.",
            "Jerapah dan manusia memiliki jumlah tulang leher yang sama: tujuh.",
            "Semut tidak pernah tidur dan tidak memiliki paru-paru.",
            "Kucing menghabiskan 70% hidupnya untuk tidur.",
            "Lalat rumah bersenandung pada nada F.",
            "Siput bisa tidur hingga 3 tahun.",
            "Kuda laut jantan yang mengandung dan melahirkan bayi.",
            "Capung memiliki 6 kaki tapi tidak bisa berjalan.",
            "Beruang kutub memiliki kulit hitam di bawah bulunya yang putih.",
            "Lumba-lumba memberi nama pada satu sama lain menggunakan peluit unik.",
            "Hewan tercepat di darat adalah cheetah, bisa berlari hingga 112 km/jam.",
            "Burung kolibri adalah satu-satunya burung yang bisa terbang mundur.",
            "Sapi memiliki sahabat dan menjadi stres jika dipisahkan.",
            "Bintang laut tidak memiliki otak.",
            "Kupu-kupu merasakan makanan dengan kakinya.",
            "Gigi lumba-lumba digunakan sebagai antena, bukan untuk mengunyah.",
            "Gurita betina mati setelah telurnya menetas karena berhenti makan.",
            
            // === FAKTA INDONESIA ===
            "Indonesia memiliki lebih dari 17.000 pulau, menjadikannya negara kepulauan terbesar di dunia.",
            "Bahasa Indonesia resmi ditetapkan pada 28 Oktober 1928 melalui Sumpah Pemuda.",
            "Indonesia adalah rumah bagi Komodo, kadal terbesar di dunia.",
            "Raja Ampat di Papua memiliki 75% spesies karang dunia.",
            "Indonesia memiliki lebih dari 700 bahasa daerah.",
            "Borobudur adalah candi Buddha terbesar di dunia.",
            "Indonesia adalah produsen minyak kelapa sawit terbesar di dunia.",
            "Pulau Jawa adalah pulau terpadat di dunia dengan lebih dari 140 juta penduduk.",
            "Indonesia memiliki hutan hujan tropis terbesar ketiga di dunia setelah Amazon dan Kongo.",
            "Bunga Rafflesia arnoldii, bunga terbesar di dunia, hanya ditemukan di Sumatera.",
            "Indonesia berada di Cincin Api Pasifik dan memiliki lebih dari 130 gunung berapi aktif.",
            "Kopi Luwak dari Indonesia adalah kopi termahal di dunia.",
            "Candi Prambanan adalah kompleks candi Hindu terbesar di Asia Tenggara.",
            "Indonesia adalah eksportir nikel terbesar di dunia.",
            "Batik Indonesia telah diakui UNESCO sebagai Warisan Budaya Dunia.",
            "Orangutan hanya ditemukan di Sumatera dan Kalimantan.",
            "Indonesia memiliki garis pantai terpanjang kedua di dunia setelah Kanada.",
            "Danau Toba adalah danau vulkanik terbesar di dunia.",
            "Wayang Indonesia juga diakui UNESCO sebagai Warisan Budaya Dunia.",
            "Indonesia adalah penghasil timah terbesar kedua di dunia.",
            
            // === FAKTA SEJARAH ===
            "Tembok Besar Cina tidak terlihat dari luar angkasa dengan mata telanjang.",
            "Cleopatra hidup lebih dekat dengan peluncuran iPhone daripada dengan pembangunan Piramida Giza.",
            "Mesin faks ditemukan tahun 1843, sebelum telepon ditemukan.",
            "Universitas tertua di dunia, Universitas al-Qarawiyyin, didirikan oleh seorang wanita.",
            "Piramida Giza dulunya berwarna putih berkilau karena dilapisi batu kapur yang dipoles.",
            "Manusia purba menggunakan air liur sebagai cat untuk lukisan gua.",
            "Raja Tutankhamun adalah raja Mesir pertama yang diketahui memiliki gigi berlubang.",
            "Cokelat pernah digunakan sebagai mata uang oleh suku Aztec.",
            "Kuda nil adalah hewan yang paling mematikan di Afrika, bukan singa.",
            "Pada Abad Pertengahan, tomato dianggap beracun di Eropa.",
            "Oxford University lebih tua dari Kekaisaran Aztec.",
            "Mumi Mesir kuno dulunya dijadikan obat di Eropa.",
            "Islandia adalah negara demokrasi tertua di dunia yang masih berjalan.",
            "Perang 100 Tahun sebenarnya berlangsung selama 116 tahun.",
            "Konstantinopel pernah menjadi ibu kota dari tiga kekaisaran berbeda.",
            "Orang Romawi kuno menggunakan urine untuk memutihkan gigi.",
            "Warna wortel asli adalah ungu, bukan oranye.",
            "Samurai Jepang pernah menjadi kasta sosial tertinggi.",
            "Jam tangan pertama dibuat untuk wanita, bukan pria.",
            "Albert Einstein ditawari menjadi Presiden Israel tapi menolak.",
            
            // === FAKTA TEKNOLOGI ===
            "Email pertama dikirim pada tahun 1971 oleh Ray Tomlinson.",
            "Nama asli Google adalah 'Backrub'.",
            "92% mata uang dunia berbentuk digital, bukan uang fisik.",
            "Website pertama masih online di info.cern.ch.",
            "Lebih banyak orang di dunia yang punya ponsel daripada sikat gigi.",
            "Pertama kali kata 'robot' digunakan adalah dalam drama tahun 1920.",
            "QWERTY keyboard dirancang untuk memperlambat pengetikan agar mesin ketik tidak macet.",
            "Emoji pertama diciptakan di Jepang tahun 1999.",
            "Ada lebih banyak kemungkinan permainan catur daripada atom di alam semesta.",
            "Domain google.com didaftarkan pada 15 September 1997.",
            "Komputer pertama seberat 27 ton.",
            "Password yang paling umum digunakan adalah '123456'.",
            "Nintendo didirikan tahun 1889 sebagai perusahaan kartu.",
            "Virus komputer pertama dibuat tahun 1986.",
            "YouTube diluncurkan sebagai situs kencan online.",
            "Amazon awalnya menjual buku saja.",
            "Apple memiliki lebih banyak uang tunai daripada beberapa negara.",
            "Rata-rata orang menghabiskan 2 jam sehari di media sosial.",
            "Internet membutuhkan lebih dari 50 juta kuda daya untuk beroperasi.",
            "SpaceX berhasil mendaratkan roket yang bisa digunakan kembali.",
            
            // === FAKTA LUAR ANGKASA ===
            "Satu hari di Mars adalah 24 jam 37 menit.",
            "Matahari membutuhkan sekitar 230 juta tahun untuk mengorbit pusat galaksi.",
            "Cahaya dari Matahari membutuhkan 8 menit 20 detik untuk mencapai Bumi.",
            "Jejak kaki di Bulan akan bertahan jutaan tahun karena tidak ada angin.",
            "Ada lebih banyak bintang di alam semesta daripada butiran pasir di Bumi.",
            "Jupiter cukup besar untuk menampung 1.300 Bumi.",
            "Saturnus bisa mengapung di air karena kepadatannya sangat rendah.",
            "Satu tahun di Pluto sama dengan 248 tahun Bumi.",
            "Venus berputar terbalik, matahari terbit di barat dan terbenam di timur.",
            "Bulan menjauh dari Bumi sekitar 3,8 cm setiap tahun.",
            "Jika kamu menangis di luar angkasa, air mata tidak akan jatuh.",
            "Ada gunung di Mars yang tingginya hampir 3 kali Gunung Everest.",
            "Lubang hitam terdekat berjarak sekitar 1.000 tahun cahaya dari Bumi.",
            "Galaksi Andromeda akan bertabrakan dengan Bima Sakti dalam 4,5 miliar tahun.",
            "Di luar angkasa, logam bisa menempel satu sama lain secara permanen.",
            "Satu hari di Merkurius sama dengan 59 hari Bumi.",
            "Bintang Betelgeuse bisa meledak kapan saja (dalam skala kosmis).",
            "Asteroid belt berisi jutaan asteroid tapi jarak antar asteroid sangat jauh.",
            "Voyager 1 adalah objek buatan manusia terjauh dari Bumi.",
            "Tata surya kita bergerak dengan kecepatan 828.000 km/jam melintasi galaksi.",
            
            // === FAKTA TUBUH MANUSIA ===
            "Tulang manusia lebih kuat dari baja per satuan beratnya.",
            "Manusia berbagi 50% DNA dengan pisang.",
            "Mata manusia tetap ukurannya sejak lahir, tetapi hidung dan telinga terus tumbuh.",
            "Kulit adalah organ terbesar tubuh manusia.",
            "Tubuh manusia menghasilkan 25 juta sel baru setiap detik.",
            "Bersin tidak bisa dilakukan dengan mata terbuka.",
            "Perut manusia mendapatkan lapisan lendir baru setiap dua minggu.",
            "Kuku tangan tumbuh lebih cepat dari kuku kaki.",
            "Tulang paha lebih kuat dari beton.",
            "Otak manusia tidak bisa merasakan sakit karena tidak memiliki reseptor rasa sakit.",
            "Telinga dan hidung manusia terus tumbuh seumur hidup.",
            "Tubuh manusia mengandung 0,2 mg emas.",
            "Rata-rata manusia berjalan sejauh 100.000 km seumur hidupnya.",
            "Darah merah sebenarnya berwarna merah cerah ketika teroksigenasi.",
            "Manusia adalah satu-satunya hewan yang bisa malu.",
            "Seorang bayi memiliki 300 tulang, yang kemudian menyatu menjadi 206.",
            "Manusia menghabiskan sekitar 25 tahun untuk tidur seumur hidupnya.",
            "Lidah manusia memiliki sidik yang unik seperti sidik jari.",
            "Tubuh mengganti setiap atom dalam 7-10 tahun.",
            "Jantung manusia memompa sekitar 7.500 liter darah setiap hari.",
            
            // === FAKTA MAKANAN ===
            "Madu adalah satu-satunya makanan yang tidak pernah basi.",
            "Apel mengandung lebih banyak kafein daripada kopi.",
            "Wortel awalnya berwarna ungu sebelum dibudidayakan menjadi oranye.",
            "Cokelat hitam mengandung antioksidan lebih banyak dari beberapa buah.",
            "Kentang adalah 80% air.",
            "Stroberi bukan buah beri, tapi pisang adalah buah beri.",
            "Kacang mete tumbuh di luar buah, bukan di dalam.",
            "Es krim pertama kali dibuat di China.",
            "Satu cabai mengandung lebih banyak vitamin C dari satu jeruk.",
            "Vanila adalah rempah termahal kedua setelah saffron.",
            "Tomat dulunya dianggap beracun oleh orang Eropa.",
            "Nanas membutuhkan 2-3 tahun untuk matang sepenuhnya.",
            "McDonald's menjual 75 hamburger setiap detik.",
            "Pizza Hawaii diciptakan di Kanada, bukan di Hawaii.",
            "Kecap awalnya dibuat dari ikan, bukan kedelai.",
            "Mentimun adalah 96% air.",
            "Popcorn adalah camilan tertua yang masih dikonsumsi hingga kini.",
            "Susu UHT bisa bertahan berbulan-bulan tanpa kulkas.",
            "Keju paling dicuri di dunia.",
            "Satu buah lemon mengandung lebih banyak gula dari satu buah stroberi.",
            
            // === FAKTA UNIK ===
            "Tidak ada dua zebra yang memiliki garis yang sama persis.",
            "Kelapa membunuh lebih banyak orang daripada hiu setiap tahunnya.",
            "Sebuah awan rata-rata memiliki berat sekitar 500.000 kg.",
            "Tidak ada kata dalam bahasa Inggris yang berima dengan 'orange'.",
            "Kuku jari tengah tumbuh paling cepat.",
            "Lebih banyak orang takut laba-laba daripada kematian.",
            "Rata-rata orang menghabiskan 6 bulan menunggu lampu merah seumur hidupnya.",
            "Seekor jerapah bisa membersihkan telinganya sendiri dengan lidahnya.",
            "Otot terkuat di tubuh adalah rahang.",
            "Seseorang membakar lebih banyak kalori saat tidur daripada menonton TV.",
            "Ada lebih banyak pesawat di laut daripada kapal selam di langit.",
            "Waktu berjalan lebih lambat di dekat objek masif seperti Bumi.",
            "Satu potong kertas tidak bisa dilipat lebih dari 7 kali dengan tangan.",
            "Warna merah tidak benar-benar membuat banteng marah, mereka buta warna.",
            "Seekor siput bisa tidur selama 3 tahun.",
            "Tidak ada jam di kasino Las Vegas untuk membuat pengunjung lupa waktu.",
            "Lumba-lumba memberikan nama pada satu sama lain.",
            "Pinguin bisa minum air asin karena memiliki kelenjar khusus.",
            "Seekor kuda nil bisa berlari lebih cepat dari manusia.",
            "Ada jenis ubur-ubur yang secara teknis tidak bisa mati."
        ];
    }
}

module.exports = FactCommand;
