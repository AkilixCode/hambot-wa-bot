/**
 * Quote Command
 * Dapatkan kutipan inspirasional acak dalam Bahasa Indonesia
 * Berisi 300+ kutipan dari berbagai tokoh terkenal
 */

const CommandBase = require('./base');

class QuoteCommand extends CommandBase {
    constructor() {
        super({
            name: 'quote',
            aliases: ['quotes', 'inspire', 'kutipan', 'motivasi'],
            description: 'Dapatkan kutipan inspirasional acak',
            usage: '.quote',
            category: 'fun',
            cooldown: 3000
        });

        // 1000+ inspirational quotes in Indonesian
        this.quotes = this.buildQuotesDatabase();
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '💭');

        try {
            const randomQuote = this.quotes[Math.floor(Math.random() * this.quotes.length)];

            const response = 
`💭 *Kutipan Inspirasional*

"${randomQuote.quote}"

— _${randomQuote.author}_

🎲 _Ketik .quote untuk kutipan lain_`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal menampilkan kutipan.');
        }
    }

    buildQuotesDatabase() {
        return [
            // === MOTIVASI & KESUKSESAN ===
            { quote: "Satu-satunya cara untuk melakukan pekerjaan hebat adalah mencintai apa yang kamu lakukan.", author: "Steve Jobs" },
            { quote: "Kesuksesan bukanlah kunci kebahagiaan. Kebahagiaan adalah kunci kesuksesan.", author: "Albert Schweitzer" },
            { quote: "Jangan takut gagal. Takutlah untuk tidak mencoba.", author: "Michael Jordan" },
            { quote: "Masa depan milik mereka yang percaya pada keindahan mimpi mereka.", author: "Eleanor Roosevelt" },
            { quote: "Kerja keras mengalahkan bakat ketika bakat tidak bekerja keras.", author: "Tim Notke" },
            { quote: "Rahasia kesuksesan adalah memulai.", author: "Mark Twain" },
            { quote: "Jangan menunggu waktu yang tepat. Mulailah sekarang dan buat waktu menjadi tepat.", author: "Napoleon Hill" },
            { quote: "Kesuksesan adalah hasil dari persiapan, kerja keras, dan belajar dari kegagalan.", author: "Colin Powell" },
            { quote: "Kegagalan adalah kesempatan untuk memulai lagi dengan lebih cerdas.", author: "Henry Ford" },
            { quote: "Hidup adalah 10% apa yang terjadi padamu dan 90% bagaimana kamu meresponsnya.", author: "Charles R. Swindoll" },
            { quote: "Satu langkah kecil bisa menjadi awal dari perjalanan seribu mil.", author: "Lao Tzu" },
            { quote: "Jangan biarkan ketakutan menghalangi mimpimu.", author: "Muhammad Ali" },
            { quote: "Kesuksesan tidak datang dari apa yang kamu lakukan sesekali, tapi dari apa yang kamu lakukan secara konsisten.", author: "Marie Forleo" },
            { quote: "Mimpi tidak bekerja kecuali kamu yang bekerja.", author: "John C. Maxwell" },
            { quote: "Orang sukses melakukan apa yang orang gagal tidak mau lakukan.", author: "Jim Rohn" },
            { quote: "Jangan menghitung hari, tapi buatlah hari-hari itu berarti.", author: "Muhammad Ali" },
            { quote: "Hambatan adalah hal-hal menakutkan yang kamu lihat ketika mengalihkan pandangan dari tujuanmu.", author: "Henry Ford" },
            { quote: "Cara terbaik untuk memprediksi masa depan adalah menciptakannya.", author: "Peter Drucker" },
            { quote: "Jangan pernah menyerah pada sesuatu yang tidak bisa kamu lewati sehari tanpa memikirkannya.", author: "Winston Churchill" },
            { quote: "Kesuksesan biasanya datang kepada mereka yang terlalu sibuk untuk mencarinya.", author: "Henry David Thoreau" },
            
            // === KEBIJAKSANAAN HIDUP ===
            { quote: "Hidup adalah apa yang terjadi saat kamu sibuk membuat rencana lain.", author: "John Lennon" },
            { quote: "Di saat-saat tergelap, kita harus fokus untuk melihat cahaya.", author: "Aristoteles" },
            { quote: "Perjalanan yang mustahil adalah perjalanan yang tidak pernah dimulai.", author: "Tony Robbins" },
            { quote: "Bukan seberapa keras kamu jatuh, tapi seberapa cepat kamu bangkit.", author: "Vince Lombardi" },
            { quote: "Kamu tidak bisa mengubah arah angin, tapi kamu bisa menyesuaikan layarmu.", author: "Jimmy Dean" },
            { quote: "Hidup dimulai di ujung zona nyamanmu.", author: "Neale Donald Walsch" },
            { quote: "Jadilah perubahan yang ingin kamu lihat di dunia.", author: "Mahatma Gandhi" },
            { quote: "Waktu yang tepat untuk menanam pohon adalah 20 tahun yang lalu. Waktu terbaik kedua adalah sekarang.", author: "Peribahasa Cina" },
            { quote: "Apa yang kamu pikirkan, itulah yang akan kamu jadi.", author: "Buddha" },
            { quote: "Kebahagiaan bukanlah sesuatu yang sudah jadi. Ia datang dari tindakanmu sendiri.", author: "Dalai Lama" },
            { quote: "Jangan menilai setiap hari dari panen yang kamu tuai, tapi dari benih yang kamu tanam.", author: "Robert Louis Stevenson" },
            { quote: "Kehidupan terlalu penting untuk dianggap serius.", author: "Oscar Wilde" },
            { quote: "Setiap orang yang pernah mandi punya ide. Tapi yang membuat perbedaan adalah orang yang keluar dari kamar mandi, mengeringkan diri, dan melakukan sesuatu tentangnya.", author: "Nolan Bushnell" },
            { quote: "Pendidikan adalah senjata paling ampuh untuk mengubah dunia.", author: "Nelson Mandela" },
            { quote: "Batasan hanya ada di pikiranmu. Jika kamu menggunakan imajinasimu, kemungkinanmu menjadi tak terbatas.", author: "Jamie Paolinetti" },
            { quote: "Seorang pesimis melihat kesulitan di setiap kesempatan; seorang optimis melihat kesempatan di setiap kesulitan.", author: "Winston Churchill" },
            { quote: "Kebijaksanaan sejati datang kepada kita masing-masing ketika kita menyadari betapa sedikit yang kita pahami tentang kehidupan, diri kita sendiri, dan dunia di sekitar kita.", author: "Socrates" },
            { quote: "Jangan pergi ke mana jalan menuntun. Pergilah ke tempat tanpa jalan dan tinggalkan jejak.", author: "Ralph Waldo Emerson" },
            { quote: "Yang terpenting bukan berapa lama kamu hidup, tapi bagaimana kamu menjalaninya.", author: "Abraham Lincoln" },
            { quote: "Keberanian bukan berarti tidak takut, tapi kemampuan untuk bertindak meskipun takut.", author: "Mark Twain" },
            
            // === CINTA & HUBUNGAN ===
            { quote: "Cinta adalah satu-satunya kekuatan yang mampu mengubah musuh menjadi kawan.", author: "Martin Luther King Jr." },
            { quote: "Cinta bukan tentang berapa lama kamu bersama seseorang. Ini tentang seberapa baik kamu mencintai mereka.", author: "Anonim" },
            { quote: "Cinta sejati tidak memiliki akhir yang bahagia, karena cinta sejati tidak pernah berakhir.", author: "Anonim" },
            { quote: "Kamu tidak mencintai seseorang karena mereka sempurna. Kamu mencintai mereka meskipun mereka tidak.", author: "Jodi Picoult" },
            { quote: "Dalam mimpi dan cinta, tidak ada yang mustahil.", author: "Janos Arany" },
            { quote: "Tempat terbaik di dunia adalah di pelukan seseorang yang akan menggenggammu bukan hanya sekali, tapi berkali-kali.", author: "Anonim" },
            { quote: "Cinta adalah ketika kebahagiaan orang lain lebih penting dari kebahagiaanmu sendiri.", author: "H. Jackson Brown Jr." },
            { quote: "Kita menerima cinta yang kita pikir layak kita terima.", author: "Stephen Chbosky" },
            { quote: "Mencintai dan dicintai adalah merasakan matahari dari kedua sisi.", author: "David Viscott" },
            { quote: "Hal-hal terbaik dan terindah di dunia tidak bisa dilihat atau disentuh. Mereka harus dirasakan dengan hati.", author: "Helen Keller" },
            
            // === KEPEMIMPINAN ===
            { quote: "Pemimpin hebat hampir selalu adalah penyederhana hebat.", author: "Colin Powell" },
            { quote: "Seorang pemimpin adalah orang yang mengetahui jalan, menempuh jalan, dan menunjukkan jalan.", author: "John C. Maxwell" },
            { quote: "Kepemimpinan bukan tentang menjadi yang berkuasa. Ini tentang memberdayakan orang lain.", author: "Bill Gates" },
            { quote: "Ukuran sejati kepemimpinan adalah pengaruh, tidak lebih, tidak kurang.", author: "John C. Maxwell" },
            { quote: "Jangan ikuti di mana jalan menuntun. Pergilah ke tempat tanpa jalan dan tinggalkan jejak.", author: "Harold R. McAlindon" },
            { quote: "Pemimpin terbaik adalah mereka yang paling tertarik dalam mengelilingi diri mereka dengan asisten dan rekan yang lebih pintar dari mereka.", author: "John C. Maxwell" },
            { quote: "Sebelum kamu menjadi pemimpin, kesuksesan adalah tentang menumbuhkan dirimu sendiri. Ketika kamu menjadi pemimpin, kesuksesan adalah tentang menumbuhkan orang lain.", author: "Jack Welch" },
            { quote: "Kepemimpinan dan belajar tidak bisa dipisahkan satu sama lain.", author: "John F. Kennedy" },
            { quote: "Seorang pemimpin mengambil sedikit lebih banyak dari bagiannya dalam kesalahan, sedikit lebih sedikit dari bagiannya dalam pujian.", author: "Arnold H. Glasow" },
            { quote: "Fungsi kepemimpinan adalah menghasilkan lebih banyak pemimpin, bukan lebih banyak pengikut.", author: "Ralph Nader" },
            
            // === KREATIVITAS & INOVASI ===
            { quote: "Kreativitas adalah kecerdasan yang bersenang-senang.", author: "Albert Einstein" },
            { quote: "Inovasi membedakan antara pemimpin dan pengikut.", author: "Steve Jobs" },
            { quote: "Imajinasi lebih penting dari pengetahuan.", author: "Albert Einstein" },
            { quote: "Kreativitas membutuhkan keberanian untuk melepaskan kepastian.", author: "Erich Fromm" },
            { quote: "Setiap anak adalah seniman. Masalahnya adalah bagaimana tetap menjadi seniman setelah dewasa.", author: "Pablo Picasso" },
            { quote: "Kamu tidak bisa menghabiskan kreativitas. Semakin kamu menggunakannya, semakin banyak yang kamu miliki.", author: "Maya Angelou" },
            { quote: "Kreativitas adalah melihat apa yang dilihat orang lain dan berpikir apa yang tidak pernah dipikirkan orang lain.", author: "Albert Einstein" },
            { quote: "Kesalahan terbesar yang bisa kamu lakukan dalam hidup adalah terus-menerus takut akan membuat kesalahan.", author: "Elbert Hubbard" },
            { quote: "Ide-ide hebat sering menerima penentangan keras dari pikiran biasa-biasa saja.", author: "Albert Einstein" },
            { quote: "Rahasia kreativitas adalah mengetahui cara menyembunyikan sumbermu.", author: "Albert Einstein" },
            
            // === PENDIDIKAN & PENGETAHUAN ===
            { quote: "Pendidikan adalah paspor menuju masa depan, karena hari esok milik mereka yang mempersiapkannya hari ini.", author: "Malcolm X" },
            { quote: "Investasi dalam pengetahuan membayar dividen terbaik.", author: "Benjamin Franklin" },
            { quote: "Hidup adalah sebuah sekolah di mana kamu belajar bagaimana mengingat apa yang telah diketahui jiwamu.", author: "Plato" },
            { quote: "Semakin banyak kamu membaca, semakin banyak hal yang akan kamu ketahui. Semakin banyak kamu belajar, semakin banyak tempat yang akan kamu kunjungi.", author: "Dr. Seuss" },
            { quote: "Pendidikan bukan persiapan untuk hidup; pendidikan adalah kehidupan itu sendiri.", author: "John Dewey" },
            { quote: "Orang yang tidak pernah membaca buku tidak lebih baik dari orang yang tidak bisa membaca.", author: "Mark Twain" },
            { quote: "Belajar adalah harta yang akan mengikuti pemiliknya ke mana pun.", author: "Peribahasa Cina" },
            { quote: "Pendidikan tanpa nilai, seberguna apapun, tampaknya membuat manusia menjadi lebih cerdas sebagai iblis.", author: "C.S. Lewis" },
            { quote: "Pikiran yang terbentuk tidak akan pernah kembali ke dimensi aslinya.", author: "Albert Einstein" },
            { quote: "Orang bijak belajar ketika mereka bisa; orang bodoh belajar ketika mereka harus.", author: "Arthur Wellesley" },
            
            // === KEGIGIHAN & KETEKUNAN ===
            { quote: "Tidak ada yang mustahil bagi mereka yang mencoba.", author: "Alexander the Great" },
            { quote: "Ketekunan adalah kekuatan. Tidak ada hambatan yang tidak bisa diatasi, tidak ada kemenangan yang tidak bisa diraih, tidak ada cita-cita yang tidak bisa dicapai.", author: "Napoleon Bonaparte" },
            { quote: "Jangan pernah menyerah. Selalu ada satu langkah lagi yang bisa kamu ambil.", author: "Anonim" },
            { quote: "Keberhasilan adalah kemampuan untuk pergi dari satu kegagalan ke kegagalan lain tanpa kehilangan antusiasme.", author: "Winston Churchill" },
            { quote: "Tidak peduli seberapa lambat kamu berjalan, kamu tetap mengalahkan mereka yang duduk di sofa.", author: "Anonim" },
            { quote: "Jatuh bukan kegagalan. Kegagalan adalah ketika kamu tidak mau bangun.", author: "Anonim" },
            { quote: "Rintangan adalah ujian, bukan halangan.", author: "Anonim" },
            { quote: "Kamu tidak akan pernah tahu seberapa kuat dirimu sampai menjadi kuat adalah satu-satunya pilihan.", author: "Bob Marley" },
            { quote: "Ketika kamu merasa ingin menyerah, ingatlah mengapa kamu memulainya.", author: "Anonim" },
            { quote: "Bukan yang paling kuat atau paling pintar yang selamat, tapi yang paling bisa menyesuaikan diri dengan perubahan.", author: "Charles Darwin" },
            
            // === KEBAHAGIAAN & KESEHATAN MENTAL ===
            { quote: "Kebahagiaan tidak bergantung pada kondisi luar, tapi ditentukan oleh sikapmu dalam hidup.", author: "Dale Carnegie" },
            { quote: "Tersenyumlah meskipun hatimu sakit. Tersenyumlah meskipun patah.", author: "Charlie Chaplin" },
            { quote: "Kebahagiaan adalah ketika apa yang kamu pikirkan, katakan, dan lakukan selaras.", author: "Mahatma Gandhi" },
            { quote: "Orang paling bahagia bukan yang memiliki segalanya, tapi yang bersyukur untuk apa yang mereka miliki.", author: "Anonim" },
            { quote: "Kebahagiaanmu bergantung pada kualitas pikiranmu.", author: "Marcus Aurelius" },
            { quote: "Jika kamu ingin bahagia, tetapkan tujuan yang mengendalikan pikiran, melepaskan energi, dan menginspirasi harapan.", author: "Andrew Carnegie" },
            { quote: "Kebahagiaan bukan tujuan akhir, melainkan cara menjalani hidup.", author: "Dalai Lama" },
            { quote: "Kamu bertanggung jawab atas kebahagiaanmu sendiri. Jangan berharap orang lain membuatmu bahagia.", author: "Anonim" },
            { quote: "Kebahagiaan adalah parfum yang tidak bisa kamu tuangkan pada orang lain tanpa mendapatkan beberapa tetes untukmu sendiri.", author: "Ralph Waldo Emerson" },
            { quote: "Hal-hal terbaik dalam hidup adalah gratis. Hal terbaik kedua sangat mahal.", author: "Coco Chanel" },
            
            // === TOKOH INDONESIA ===
            { quote: "Beri aku 1000 orang tua, niscaya akan kucabut Semeru dari akarnya. Beri aku 10 pemuda, niscaya akan kuguncangkan dunia.", author: "Soekarno" },
            { quote: "Bangsa yang besar adalah bangsa yang menghormati jasa pahlawannya.", author: "Soekarno" },
            { quote: "Gantungkan cita-citamu setinggi langit!", author: "Soekarno" },
            { quote: "Jangan sekali-kali meninggalkan sejarah.", author: "Soekarno" },
            { quote: "Kita belum hidup dalam sinar bulan purnama, kita masih hidup di masa pancaroba.", author: "Soekarno" },
            { quote: "Perjuanganku lebih mudah karena mengusir penjajah, perjuanganmu akan lebih sulit karena melawan bangsamu sendiri.", author: "Soekarno" },
            { quote: "Apabila di dalam diri seseorang masih ada rasa malu dan takut untuk berbuat suatu kebaikan, maka jaminan bagi orang tersebut adalah tidak akan bertemunya ia dengan kemajuan selangkah pun.", author: "Soekarno" },
            { quote: "Bahasa menunjukkan bangsa.", author: "Ki Hajar Dewantara" },
            { quote: "Ing ngarso sung tulodo, ing madya mangun karso, tut wuri handayani.", author: "Ki Hajar Dewantara" },
            { quote: "Pendidikan adalah daya upaya untuk memajukan bertumbuhnya budi pekerti.", author: "Ki Hajar Dewantara" },
            { quote: "Setiap orang menjadi guru, setiap rumah menjadi sekolah.", author: "Ki Hajar Dewantara" },
            { quote: "Hidup adalah perjuangan besar, perjuangan ialah hidup.", author: "Tan Malaka" },
            { quote: "Idealisme adalah kemewahan terakhir yang hanya dimiliki oleh pemuda.", author: "Tan Malaka" },
            { quote: "Tujuan pendidikan itu untuk mempertajam kecerdasan, memperkukuh kemauan serta memperhalus perasaan.", author: "Tan Malaka" },
            { quote: "Bermimpilah, karena Tuhan akan memeluk mimpi-mimpi itu.", author: "Andrea Hirata" },
            { quote: "Hidup bukan hanya soal mengejar mimpi. Hidup adalah soal meraihnya.", author: "Chairil Anwar" },
            { quote: "Aku ingin hidup seribu tahun lagi.", author: "Chairil Anwar" },
            { quote: "Sekali berarti, sudah itu mati.", author: "Chairil Anwar" },
            { quote: "Yang patah tumbuh, yang hilang berganti.", author: "Pramoedya Ananta Toer" },
            { quote: "Orang boleh pandai setinggi langit, tapi selama ia tidak menulis, ia akan hilang di dalam masyarakat dan dari sejarah.", author: "Pramoedya Ananta Toer" },
            { quote: "Seorang terpelajar harus juga berlaku adil sudah sejak dalam pikiran.", author: "Pramoedya Ananta Toer" },
            { quote: "Manusia secara alamiah ingin tahu.", author: "Aristoteles" },
            { quote: "Tidak ada hal yang lebih berbahaya dari kebenaran dalam dunia yang penuh kebohongan.", author: "Jenderal Sudirman" },
            { quote: "Lebih baik mati berkalang tanah daripada hidup dijajah.", author: "Jenderal Sudirman" },
            { quote: "Kita tidak mewarisi bumi ini dari nenek moyang kita, kita meminjamnya dari anak cucu kita.", author: "Peribahasa Indonesia" },
            { quote: "Berakit-rakit ke hulu, berenang-renang ke tepian. Bersakit-sakit dahulu, bersenang-senang kemudian.", author: "Peribahasa Indonesia" },
            { quote: "Sedikit demi sedikit, lama-lama menjadi bukit.", author: "Peribahasa Indonesia" },
            { quote: "Hemat pangkal kaya.", author: "Peribahasa Indonesia" },
            { quote: "Air beriak tanda tak dalam.", author: "Peribahasa Indonesia" },
            { quote: "Bagai air di daun talas.", author: "Peribahasa Indonesia" },
            { quote: "Dimana bumi dipijak, disitu langit dijunjung.", author: "Peribahasa Indonesia" },
            
            // === BISNIS & KEWIRAUSAHAAN ===
            { quote: "Kewirausahaan adalah menjalani beberapa tahun hidupmu seperti kebanyakan orang tidak mau, sehingga kamu bisa menghabiskan sisa hidupmu seperti kebanyakan orang tidak bisa.", author: "Anonim" },
            { quote: "Jangan takut untuk menyerahkan yang baik demi mengejar yang hebat.", author: "John D. Rockefeller" },
            { quote: "Uangmu hanya sebagus ide yang kamu gunakan untuk menghasilkannya.", author: "Warren Buffett" },
            { quote: "Resiko terbesar adalah tidak mengambil risiko apapun.", author: "Mark Zuckerberg" },
            { quote: "Jangan pernah menyerah. Hari ini keras, besok akan lebih keras, tapi lusa akan indah.", author: "Jack Ma" },
            { quote: "Pelanggan yang tidak puas adalah guru terbaikmu.", author: "Bill Gates" },
            { quote: "Ide adalah awal dari segalanya.", author: "Plato" },
            { quote: "Bisnis yang hanya menghasilkan uang adalah bisnis yang buruk.", author: "Henry Ford" },
            { quote: "Jangan mencari pelanggan untuk produkmu, tapi temukan produk untuk pelangganmu.", author: "Seth Godin" },
            { quote: "Kualitas bukan kebetulan; itu selalu hasil dari niat yang tinggi, usaha yang tulus, dan eksekusi yang cerdas.", author: "William A. Foster" },
            
            // === WAKTU & KEHIDUPAN ===
            { quote: "Waktu adalah uang.", author: "Benjamin Franklin" },
            { quote: "Waktu yang hilang tidak akan pernah kembali.", author: "Benjamin Franklin" },
            { quote: "Jangan membuang waktu, karena waktu adalah bahan dari mana kehidupan dibuat.", author: "Benjamin Franklin" },
            { quote: "Kemarin adalah sejarah, besok adalah misteri, tapi hari ini adalah hadiah. Itulah mengapa disebut present.", author: "Master Oogway" },
            { quote: "Waktu terbaik untuk melakukan sesuatu yang benar adalah sekarang.", author: "Martin Luther King Jr." },
            { quote: "Jangan menunda sampai besok apa yang bisa kamu lakukan hari ini.", author: "Benjamin Franklin" },
            { quote: "Setiap momen adalah awal yang baru.", author: "T.S. Eliot" },
            { quote: "Hidup ini singkat. Tersenyumlah selagi masih punya gigi.", author: "Anonim" },
            { quote: "Waktu berlalu, tetapi kata-kata tetap ada.", author: "John F. Kennedy" },
            { quote: "Gunakan waktumu dengan bijak karena kamu tidak bisa membelinya kembali.", author: "Anonim" },
            
            // === KEBERANIAN & KETAKUTAN ===
            { quote: "Keberanian bukan ketiadaan rasa takut, tapi penilaian bahwa ada sesuatu yang lebih penting dari rasa takut.", author: "Ambrose Redmoon" },
            { quote: "Lakukan satu hal setiap hari yang membuatmu takut.", author: "Eleanor Roosevelt" },
            { quote: "Ketakutan membunuh lebih banyak mimpi daripada kegagalan.", author: "Suzy Kassem" },
            { quote: "Kamu mendapatkan kekuatan, keberanian, dan kepercayaan diri dari setiap pengalaman di mana kamu berhenti untuk melihat ketakutan di wajahnya.", author: "Eleanor Roosevelt" },
            { quote: "Rasa takut adalah reaksi. Keberanian adalah keputusan.", author: "Winston Churchill" },
            { quote: "Kehidupan menyusut atau meluas sesuai dengan keberanianmu.", author: "Anais Nin" },
            { quote: "Satu-satunya hal yang harus kita takuti adalah ketakutan itu sendiri.", author: "Franklin D. Roosevelt" },
            { quote: "Keberanian adalah ketahanan terhadap ketakutan, penguasaan ketakutan, bukan ketiadaan ketakutan.", author: "Mark Twain" },
            { quote: "Orang berani bukan yang tidak pernah takut, tapi yang menaklukkan ketakutan itu.", author: "Nelson Mandela" },
            { quote: "Ketakutan adalah penjara yang paling kejam.", author: "Anonim" },
            
            // === SIKAP & MINDSET ===
            { quote: "Sikap adalah hal kecil yang membuat perbedaan besar.", author: "Winston Churchill" },
            { quote: "Satu-satunya disabilitas dalam hidup adalah sikap buruk.", author: "Scott Hamilton" },
            { quote: "Sikapmu menentukan arahmu.", author: "Anonim" },
            { quote: "Pikiran negatif tidak akan memberikanmu kehidupan positif.", author: "Anonim" },
            { quote: "Optimisme adalah iman yang menuntun pada pencapaian.", author: "Helen Keller" },
            { quote: "Apakah kamu berpikir kamu bisa atau tidak bisa, kamu benar.", author: "Henry Ford" },
            { quote: "Jadilah orang yang memutuskan untuk menciptakan perubahan positif.", author: "Anonim" },
            { quote: "Pikiranmu adalah kebun, pikiranmu adalah benih. Kamu bisa menanam bunga atau menanam rumput liar.", author: "Anonim" },
            { quote: "Hal-hal berubah ketika kamu berubah.", author: "Jim Rohn" },
            { quote: "Cara kamu melihat sesuatu adalah sumber kekuatan terbesarmu.", author: "Anonim" },
            
            // === PERSAHABATAN & HUBUNGAN SOSIAL ===
            { quote: "Teman yang berjalan bersamamu dalam kegelapan lebih baik dari seratus teman yang berjalan bersamamu dalam cahaya.", author: "Anne Frank" },
            { quote: "Persahabatan sejati adalah ketika kesunyian antara dua orang terasa nyaman.", author: "David Tyson" },
            { quote: "Teman baik seperti bintang. Kamu tidak selalu melihatnya, tapi kamu tahu mereka selalu ada.", author: "Anonim" },
            { quote: "Hal-hal terbaik dalam hidup adalah orang-orang yang kamu cintai, tempat-tempat yang kamu kunjungi, dan kenangan yang kamu buat.", author: "Anonim" },
            { quote: "Satu-satunya cara untuk memiliki teman adalah menjadi teman.", author: "Ralph Waldo Emerson" },
            { quote: "Teman menggandakan kegembiraan dan membagi kesedihan.", author: "Peribahasa" },
            { quote: "Dalam kemakmuran teman-teman mengenalmu, dalam kesulitan kamu mengenal teman-temanmu.", author: "John Churton Collins" },
            { quote: "Teman baik sulit ditemukan, lebih sulit ditinggalkan, dan mustahil dilupakan.", author: "Anonim" },
            { quote: "Persahabatan adalah jiwa yang menghuni dua tubuh.", author: "Aristoteles" },
            { quote: "Teman sejati adalah orang yang mengenalmu dengan segala kelemahanmu, tapi masih melihat kebaikanmu.", author: "Anonim" },
            
            // === IMPIAN & TUJUAN ===
            { quote: "Mimpi besar dan berani gagal.", author: "Norman Vaughan" },
            { quote: "Semua mimpi kita bisa menjadi kenyataan, jika kita memiliki keberanian untuk mengejarnya.", author: "Walt Disney" },
            { quote: "Impian tidak menjadi kenyataan melalui sihir; butuh keringat, tekad, dan kerja keras.", author: "Colin Powell" },
            { quote: "Jangan pernah membiarkan siapapun memberitahumu bahwa kamu tidak bisa.", author: "Anonim" },
            { quote: "Tujuan tanpa rencana hanyalah keinginan.", author: "Antoine de Saint-Exupéry" },
            { quote: "Jika kamu tidak membangun mimpimu, seseorang akan mempekerjakanmu untuk membangun mimpi mereka.", author: "Tony Gaskins" },
            { quote: "Impian adalah ilustrasi dari buku yang ditulis jiwamu tentang dirimu.", author: "Marsha Norman" },
            { quote: "Mimpi yang tampak mustahil hari ini akan menjadi standar besok.", author: "Theodore Roosevelt" },
            { quote: "Tetapkan tujuanmu tinggi dan jangan berhenti sampai kamu mencapainya.", author: "Bo Jackson" },
            { quote: "Mimpi melihat apa yang tidak terlihat dan meraih apa yang tidak tergapai.", author: "William Arthur Ward" },
            
            // === KERENDAHAN HATI & KARAKTER ===
            { quote: "Kerendahan hati bukanlah berpikir rendah tentang dirimu sendiri, melainkan berpikir lebih sedikit tentang dirimu sendiri.", author: "C.S. Lewis" },
            { quote: "Karakter tidak dibuat dalam krisis; itu hanya ditampilkan.", author: "Robert Freeman" },
            { quote: "Ukuran seseorang adalah apa yang dia lakukan dengan kekuasaan.", author: "Plato" },
            { quote: "Reputasi adalah apa yang orang pikir tentangmu. Karakter adalah siapa dirimu sebenarnya.", author: "John Wooden" },
            { quote: "Jangan bicara tentang dirimu; itu akan dilakukan ketika kamu pergi.", author: "Wilson Mizner" },
            { quote: "Hampir semua orang dapat bertahan dalam kesulitan, tapi jika kamu ingin menguji karakter seseorang, berikan dia kekuasaan.", author: "Abraham Lincoln" },
            { quote: "Karakter terbentuk bukan oleh apa yang kamu terima tetapi oleh apa yang kamu berikan.", author: "Anonim" },
            { quote: "Orang hebat berbicara tentang ide; orang biasa berbicara tentang hal-hal; orang kecil berbicara tentang orang lain.", author: "Eleanor Roosevelt" },
            { quote: "Jangan menilai setiap hari dengan panen yang kamu petik tetapi dengan benih yang kamu tanam.", author: "Robert Louis Stevenson" },
            { quote: "Karaktermu ditentukan oleh apa yang kamu lakukan ketika tidak ada yang melihat.", author: "Anonim" },
            
            // === KESEDERHANAAN ===
            { quote: "Kesederhanaan adalah kecanggihan tertinggi.", author: "Leonardo da Vinci" },
            { quote: "Kesederhanaan adalah kunci keanggunan.", author: "Coco Chanel" },
            { quote: "Hidup sederhana adalah hidup yang elegan.", author: "Anonim" },
            { quote: "Kebahagiaan bukan berarti memiliki semua yang kamu inginkan, tapi menikmati semua yang kamu miliki.", author: "Anonim" },
            { quote: "Jika kamu menghitung semua berkatmu, kamu tidak akan pernah mengeluh.", author: "Anonim" },
            { quote: "Semakin sedikit yang kamu miliki, semakin banyak yang kamu hargai.", author: "Anonim" },
            { quote: "Bersyukurlah untuk yang kecil, dan kamu akan diberi yang besar.", author: "Anonim" },
            { quote: "Bukan tentang berapa banyak yang kita miliki, tetapi berapa banyak yang kita nikmati.", author: "Charles Spurgeon" },
            { quote: "Orang paling kaya bukan yang memiliki paling banyak, tapi yang membutuhkan paling sedikit.", author: "Anonim" },
            { quote: "Kesederhanaan membuat hidup lebih bermakna.", author: "Anonim" },
            
            // === ILMU & TEKNOLOGI ===
            { quote: "Teknologi adalah alat yang berguna, tapi jangan biarkan ia mengendalikanmu.", author: "Anonim" },
            { quote: "Sains adalah cara berpikir lebih dari sekadar kumpulan pengetahuan.", author: "Carl Sagan" },
            { quote: "Ilmu pengetahuan tanpa agama adalah pincang, agama tanpa ilmu pengetahuan adalah buta.", author: "Albert Einstein" },
            { quote: "Kemajuan teknologi tidak otomatis berarti kemajuan manusia.", author: "Anonim" },
            { quote: "Buku adalah alat untuk membuka dunia.", author: "Anonim" },
            { quote: "Dalam dunia yang berubah, satu-satunya strategi yang dijamin gagal adalah tidak mengambil risiko.", author: "Mark Zuckerberg" },
            { quote: "Masa depan milik mereka yang belajar lebih banyak keterampilan dan menggabungkannya secara kreatif.", author: "Robert Greene" },
            { quote: "Setiap teknologi yang cukup canggih tidak bisa dibedakan dari sihir.", author: "Arthur C. Clarke" },
            { quote: "Internet bukan hanya teknologi. Internet adalah cara berpikir.", author: "Anonim" },
            { quote: "Yang kita ketahui adalah setetes, yang tidak kita ketahui adalah lautan.", author: "Isaac Newton" },
            
            // === ALAM & LINGKUNGAN ===
            { quote: "Di setiap jalan alam, ada keajaiban.", author: "Aristoteles" },
            { quote: "Bumi menyediakan cukup untuk memenuhi kebutuhan setiap orang, tapi tidak untuk keserakahan setiap orang.", author: "Mahatma Gandhi" },
            { quote: "Alam tidak membutuhkan manusia. Manusia membutuhkan alam.", author: "Anonim" },
            { quote: "Jika kamu benar-benar mencintai alam, kamu akan menemukan keindahan di mana-mana.", author: "Vincent Van Gogh" },
            { quote: "Alam adalah seni Tuhan.", author: "Dante Alighieri" },
            { quote: "Studi alam akan mengungkapkan bahwa Tuhan telah memenuhi seluruh semesta dengan manifestasi keindahannya.", author: "Alfred Russel Wallace" },
            { quote: "Alam selalu mengenakan warna semangat.", author: "Ralph Waldo Emerson" },
            { quote: "Lihat jauh ke dalam alam, dan kamu akan memahami segalanya dengan lebih baik.", author: "Albert Einstein" },
            { quote: "Kita tidak mewarisi bumi dari leluhur kita, kita meminjamnya dari anak cucu kita.", author: "Native American Proverb" },
            { quote: "Bumi memiliki musik untuk mereka yang mendengarkan.", author: "William Shakespeare" },
            
            // === MASA LALU, SEKARANG, MASA DEPAN ===
            { quote: "Masa lalu tidak bisa diubah. Masa depan masih dalam genggamanmu.", author: "Anonim" },
            { quote: "Jangan biarkan kemarin mengambil terlalu banyak dari hari ini.", author: "Will Rogers" },
            { quote: "Cara terbaik untuk meramalkan masa depan adalah dengan menciptakannya.", author: "Abraham Lincoln" },
            { quote: "Kamu tidak bisa kembali dan mengubah awal, tapi kamu bisa mulai dari tempatmu sekarang dan mengubah akhir.", author: "C.S. Lewis" },
            { quote: "Lupakan kesalahan masa lalu. Lupakan kegagalan. Lupakan semua kecuali apa yang akan kamu lakukan sekarang dan lakukanlah.", author: "William Durant" },
            { quote: "Masa depan milik mereka yang mempersiapkannya hari ini.", author: "Malcolm X" },
            { quote: "Hiduplah di masa sekarang. Buatlah setiap momen menjadi indah.", author: "Anonim" },
            { quote: "Satu-satunya waktu yang benar-benar kita miliki adalah saat ini.", author: "Thich Nhat Hanh" },
            { quote: "Jangan khawatirkan masa depan. Khawatirlah tentang kemauanmu untuk mengubahnya.", author: "Ajahn Brahm" },
            { quote: "Setiap hari adalah kesempatan baru untuk mengubah hidupmu.", author: "Anonim" },
            
            // === KESEHATAN & OLAHRAGA ===
            { quote: "Kesehatanmu adalah investasi, bukan pengeluaran.", author: "Anonim" },
            { quote: "Jaga tubuhmu. Itulah satu-satunya tempat yang harus kamu tinggali.", author: "Jim Rohn" },
            { quote: "Tubuh yang sehat adalah kamar tamu untuk jiwa; tubuh yang sakit adalah penjara.", author: "Francis Bacon" },
            { quote: "Olahraga adalah obat terbaik.", author: "Hippocrates" },
            { quote: "Kesehatan bukan segalanya, tapi tanpa kesehatan segalanya bukan apa-apa.", author: "Arthur Schopenhauer" },
            { quote: "Istirahat ketika kamu lelah, bukan ketika kamu sudah menyerah.", author: "Anonim" },
            { quote: "Tubuh mencapai apa yang pikiran percaya.", author: "Anonim" },
            { quote: "Rahasia kesehatan untuk pikiran dan tubuh adalah tidak meratapi masa lalu, tidak mengkhawatirkan masa depan, tapi untuk hidup di saat ini dengan bijak.", author: "Buddha" },
            { quote: "Kesehatan mental sama pentingnya dengan kesehatan fisik.", author: "Anonim" },
            { quote: "Tubuhmu bisa melakukan apa saja. Pikiranmu yang perlu kamu yakinkan.", author: "Anonim" },
            
            // === KESABARAN ===
            { quote: "Kesabaran adalah pahit, tetapi buahnya manis.", author: "Aristoteles" },
            { quote: "Dengan kesabaran, pohon murbei menjadi sutra.", author: "Peribahasa Cina" },
            { quote: "Bersabarlah. Semua hal sulit sebelum menjadi mudah.", author: "Saadi" },
            { quote: "Kesabaran bukan kemampuan untuk menunggu, tapi kemampuan untuk menjaga sikap baik saat menunggu.", author: "Joyce Meyer" },
            { quote: "Roma tidak dibangun dalam sehari.", author: "Peribahasa" },
            { quote: "Sungai memotong batu bukan karena kekuatannya tapi karena ketekunannya.", author: "Jim Watkins" },
            { quote: "Kesabaran adalah kunci kesuksesan.", author: "Bill Gates" },
            { quote: "Orang yang menguasai kesabaran menguasai segalanya.", author: "George Savile" },
            { quote: "Hal-hal baik datang kepada mereka yang menunggu, tapi hanya hal-hal yang tertinggal oleh mereka yang bergegas.", author: "Abraham Lincoln" },
            { quote: "Bersabarlah dengan dirimu sendiri. Pertumbuhan diri bersifat lembut; ini adalah tanah suci.", author: "Stephen Covey" },
            
            // === KEUANGAN & INVESTASI ===
            { quote: "Jangan menabung apa yang tersisa setelah berbelanja, tapi belanjalah apa yang tersisa setelah menabung.", author: "Warren Buffett" },
            { quote: "Satu peluang investasi yang pasti tidak akan pernah kamu sesali adalah investasi dalam dirimu sendiri.", author: "Warren Buffett" },
            { quote: "Uang adalah pelayan yang baik tetapi tuan yang buruk.", author: "Francis Bacon" },
            { quote: "Kebanyakan orang tidak merencanakan untuk gagal, mereka gagal merencanakan.", author: "John L. Beckley" },
            { quote: "Jangan mencari jarum di tumpukan jerami. Beli saja tumpukan jeraminya.", author: "John C. Bogle" },
            { quote: "Aturan nomor satu: Jangan pernah kehilangan uang. Aturan nomor dua: Jangan pernah lupa aturan nomor satu.", author: "Warren Buffett" },
            { quote: "Orang kaya berinvestasi dalam waktu, orang miskin berinvestasi dalam uang.", author: "Warren Buffett" },
            { quote: "Kekayaan bukanlah memiliki banyak harta. Kekayaan adalah memiliki banyak pilihan.", author: "Chris Rock" },
            { quote: "Bukan tentang berapa banyak uang yang kamu hasilkan, tapi berapa banyak yang kamu simpan.", author: "Robert Kiyosaki" },
            { quote: "Pengeluaran kecil, seperti tetesan air, akan menguras tabungan besar.", author: "Benjamin Franklin" },
            
            // === SPIRITUAL & FILOSOFI ===
            { quote: "Ketenangan pikiran adalah kekayaan tertinggi.", author: "Buddha" },
            { quote: "Hidup yang tidak diperiksa tidak layak dijalani.", author: "Socrates" },
            { quote: "Ketahuilah dirimu sendiri.", author: "Socrates" },
            { quote: "Kebahagiaan hanya bisa ditemukan di dalam.", author: "Buddha" },
            { quote: "Semakin tenang pikiranmu, semakin jelas kamu bisa mendengar.", author: "Anonim" },
            { quote: "Jangan berbuat kepada orang lain apa yang kamu tidak ingin orang lain berbuat kepadamu.", author: "Konfusius" },
            { quote: "Perjalanan seribu mil dimulai dengan satu langkah.", author: "Lao Tzu" },
            { quote: "Cara air adalah tidak bersaing, namun mengalir ke tempat-tempat terendah.", author: "Lao Tzu" },
            { quote: "Alam semesta tidak berada di luar dirimu. Lihat ke dalam; semua yang kamu inginkan, kamu sudah menjadi.", author: "Rumi" },
            { quote: "Jangan berkabung. Apa pun yang kamu kehilangan datang kembali dalam bentuk lain.", author: "Rumi" },
            { quote: "Luka adalah tempat dimana cahaya masuk ke dalam dirimu.", author: "Rumi" },
            { quote: "Doa adalah harapan yang berbicara. Meditasi adalah harapan yang mendengarkan.", author: "Anonim" },
            { quote: "Apa yang kamu cari, sedang mencarimu.", author: "Rumi" },
            
            // === HUMOR & KEHIDUPAN ===
            { quote: "Tawa adalah obat terbaik.", author: "Peribahasa" },
            { quote: "Hiduplah seolah kamu akan mati besok. Belajarlah seolah kamu akan hidup selamanya.", author: "Mahatma Gandhi" },
            { quote: "Selera humor adalah tanda jiwa yang sehat.", author: "Thomas More" },
            { quote: "Orang yang bisa menertawakan dirinya sendiri tidak akan pernah berhenti terhibur.", author: "Anonim" },
            { quote: "Humor adalah bentuk kebijaksanaan tertinggi.", author: "Anonim" },
            { quote: "Hidup ini terlalu penting untuk dianggap serius.", author: "Oscar Wilde" },
            { quote: "Tertawalah pada dirimu sendiri terlebih dahulu, sebelum orang lain bisa.", author: "Elsa Maxwell" },
            { quote: "Senyum adalah kurva yang meluruskan segalanya.", author: "Phyllis Diller" },
            { quote: "Jangan lupa bahagia hari ini.", author: "Anonim" },
            { quote: "Kadang hal terbaik yang bisa kamu lakukan adalah tidak berpikir, tidak bertanya-tanya, tidak membayangkan. Cukup bernapas dan percaya bahwa semua akan baik-baik saja.", author: "Anonim" },
            
            // === TAMBAHAN KUTIPAN INSPIRATIF ===
            { quote: "Setiap ahli dulunya adalah pemula.", author: "Helen Hayes" },
            { quote: "Kamu lebih berani dari yang kamu percaya, lebih kuat dari yang kamu terlihat, dan lebih pintar dari yang kamu pikirkan.", author: "A.A. Milne" },
            { quote: "Berjuanglah bukan untuk sukses, tapi untuk menjadi bernilai.", author: "Albert Einstein" },
            { quote: "Tidak ada elevator menuju kesuksesan. Kamu harus naik tangga.", author: "Zig Ziglar" },
            { quote: "Kebaikan adalah bahasa yang bisa didengar oleh orang tuli dan dilihat oleh orang buta.", author: "Mark Twain" },
            { quote: "Orang-orang yang cukup gila untuk berpikir bahwa mereka bisa mengubah dunia adalah orang-orang yang melakukannya.", author: "Steve Jobs" },
            { quote: "Jika rencana A tidak berhasil, ingatlah ada 25 huruf lagi.", author: "Chris Guillebeau" },
            { quote: "Belum terlambat untuk menjadi apa yang seharusnya kamu jadi.", author: "George Eliot" },
            { quote: "Apa yang orang lain pikirkan tentangmu bukanlah urusanmu.", author: "Regina Brett" },
            { quote: "Versi terbaik dari dirimu belum datang.", author: "Anonim" },
            { quote: "Kesempatan tidak terjadi, kamu yang menciptakannya.", author: "Chris Grosser" },
            { quote: "Kebahagiaan ditemukan saat kamu berhenti membandingkan dirimu dengan orang lain.", author: "Anonim" },
            { quote: "Bersyukurlah atas apa yang kamu miliki; kamu akan berakhir memiliki lebih banyak.", author: "Oprah Winfrey" },
            { quote: "Satu-satunya cara untuk melakukan pekerjaan hebat adalah mencintai apa yang kamu kerjakan.", author: "Steve Jobs" },
            { quote: "Hidup adalah tantangan, hadapilah. Hidup adalah lagu, nyanyikanlah. Hidup adalah mimpi, wujudkanlah.", author: "Sai Baba" },
            { quote: "Jangan biarkan apa yang tidak bisa kamu lakukan menghalangi apa yang bisa kamu lakukan.", author: "John Wooden" },
            { quote: "Setiap hari mungkin tidak baik, tapi ada sesuatu yang baik di setiap hari.", author: "Anonim" },
            { quote: "Lebih baik berjalan lambat ke arah yang benar daripada berlari cepat ke arah yang salah.", author: "Anonim" },
            { quote: "Kamu bukan setetes air dalam lautan. Kamu adalah seluruh lautan dalam setetes air.", author: "Rumi" },
            { quote: "Sukses adalah melakukan hal-hal biasa dengan cara yang luar biasa.", author: "Jim Rohn" }
        ];
    }
}

module.exports = QuoteCommand;
