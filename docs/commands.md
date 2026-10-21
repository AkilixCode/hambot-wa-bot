# Commands

37 commands. Type `.menu` for the list, `.menu <command>` for usage and
examples, or `.menu <category>` for one category.

### General

| Command | Aliases | Description |
| --- | --- | --- |
| `.menu` | `.help`, `.intro`, `.commands`, `.bantuan` | Menampilkan daftar perintah bot |

### AI

| Command | Aliases | Description |
| --- | --- | --- |
| `.chat` | `.ai`, `.ask`, `.tanya` | Ngobrol dengan AI langsung dari WhatsApp ([guide](ai-chat.md)) |

### Media

| Command | Aliases | Description |
| --- | --- | --- |
| `.music` | `.song`, `.mp3`, `.audio`, `.lagu` | Cari dan unduh musik YouTube |
| `.pinterest` | `.pin`, `.pint` | Cari gambar estetik dari Pinterest |
| `.say` | `.tts`, `.speak`, `.bicara` | Ubah teks jadi suara dengan AI |
| `.video` | `.vid`, `.dl`, `.download` | Unduh video dari banyak platform |

### Tools

| Command | Aliases | Description |
| --- | --- | --- |
| `.brat` | `.bratgen`, `.stikerbrat`, `.charli` | Bikin stiker gaya sampul Brat |
| `.reminder` | `.remind`, `.ingetin`, `.alarm` | Atur pengingat untuk dirimu |
| `.sticker` | `.s`, `.stiker`, `.stik` | Ubah gambar menjadi stiker |
| `.toimg` | `.toimage`, `.stickertoimg` | Ubah stiker menjadi gambar |

### Utility

| Command | Aliases | Description |
| --- | --- | --- |
| `.calc` | `.calculate`, `.math` | Hitung ekspresi matematika |
| `.qr` | `.qrcode`, `.qrgen` | Buat QR code dari teks atau URL |
| `.time` | `.timezone`, `.clock` | Cek waktu di berbagai zona waktu |
| `.translate` | `.tr`, `.trans`, `.terjemah` | Terjemahkan teks ke bahasa lain |
| `.weather` | `.cuaca`, `.wthr` | Info cuaca untuk lokasi manapun |

### Networking

| Command | Aliases | Description |
| --- | --- | --- |
| `.dns` | `.nslookup`, `.dig`, `.resolve` | Lookup DNS untuk domain |
| `.ipinfo` | `.ip`, `.whois`, `.ipcheck` | Dapatkan informasi alamat IP |
| `.netinfo` | `.network`, `.netcheat`, `.jaringan` | Referensi jaringan komputer |
| `.port` | `.ports`, `.portlist`, `.portinfo` | Referensi port jaringan umum |
| `.subnet` | `.cidr`, `.ipcalc`, `.subnetcalc` | Hitung subnet dari IP dan CIDR |

### Information

| Command | Aliases | Description |
| --- | --- | --- |
| `.crypto` | `.kripto`, `.bitcoin`, `.btc` | Cek harga cryptocurrency terkini |
| `.gempa` | `.earthquake`, `.quake` | Info gempa terbaru dari BMKG |
| `.wiki` | `.wikipedia` | Cari ringkasan artikel Wikipedia |

### Entertainment

| Command | Aliases | Description |
| --- | --- | --- |
| `.movie` | `.film`, `.imdb` | Info film, rating, dan sinopsis |

### Fun

| Command | Aliases | Description |
| --- | --- | --- |
| `.8ball` | `.8b`, `.ask` | Tanya bola ajaib ya atau tidak |
| `.dice` | `.roll`, `.d` | Lempar dadu, bisa banyak sekaligus |
| `.fact` | `.randomfact`, `.funfact`, `.fakta` | Dapatkan fakta menarik acak |
| `.flip` | `.coin`, `.coinflip` | Lempar koin, angka atau gambar |
| `.meme` | `.memes`, `.memeindo` | Dapatkan meme Indonesia acak |
| `.quote` | `.quotes`, `.inspire`, `.kutipan`, `.motivasi` | Kutipan inspirasional acak |
| `.rps` | `.rockpaperscissors`, `.suit` | Main batu gunting kertas |
| `.spam` | `.prank` | Prank spam chat (owner only) |
| `.trivia` | `.quiz`, `.question` | Main kuis trivia acak |

### Group

| Command | Aliases | Description |
| --- | --- | --- |
| `.info` | `.groupinfo`, `.grup` | Info dan statistik grup |
| `.tagall` | `.everyone`, `.all`, `.hidetag` | Tag semua anggota grup (admin only) |

### System

| Command | Aliases | Description |
| --- | --- | --- |
| `.ping` | `.p`, `.status` | Cek waktu respon dan status sistem |

### Security

| Command | Aliases | Description |
| --- | --- | --- |
| `.security` | `.sec`, `.secstatus` | Panel manajemen keamanan (owner only) |

`.video` and `.music` accept URLs from 30+ platforms, including short forms such
as `vt.tiktok.com`, `youtu.be`, and `fb.watch`. See `utils/url-parser.js` for
the full list.
