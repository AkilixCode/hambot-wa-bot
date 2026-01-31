/**
 * NetInfo Command
 * Cheat sheet dan referensi networking
 */

const CommandBase = require('./base');

class NetInfoCommand extends CommandBase {
    constructor() {
        super({
            name: 'netinfo',
            aliases: ['network', 'netcheat', 'jaringan'],
            description: 'Cheat sheet dan referensi networking',
            usage: '.netinfo [topik]',
            category: 'technical',
            cooldown: 2000
        });

        this.topics = {
            'osi': this.getOSIModel.bind(this),
            'tcpip': this.getTCPIPModel.bind(this),
            'subnetting': this.getSubnettingGuide.bind(this),
            'cable': this.getCableTypes.bind(this),
            'kabel': this.getCableTypes.bind(this),
            'ipclass': this.getIPClasses.bind(this),
            'command': this.getNetworkCommands.bind(this),
            'perintah': this.getNetworkCommands.bind(this),
            'topology': this.getTopologies.bind(this),
            'topologi': this.getTopologies.bind(this),
            'wifi': this.getWiFiStandards.bind(this),
            'binary': this.getBinaryConversion.bind(this),
            'biner': this.getBinaryConversion.bind(this)
        };
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        // Jika tidak ada argumen, tampilkan menu
        if (!args[0]) {
            return await this.sendMainMenu(sock, from, msg);
        }

        await this.react(sock, msg, '📚');

        const topic = args[0].toLowerCase();
        const topicHandler = this.topics[topic];

        if (!topicHandler) {
            return await this.reply(sock, from, msg, 
                `❌ Topik "${topic}" tidak ditemukan.\n\n` +
                `Topik tersedia: osi, tcpip, subnetting, cable, ipclass, command, topology, wifi, binary`);
        }

        try {
            const content = topicHandler();
            await this.reply(sock, from, msg, content);
            await this.react(sock, msg, '✅');
        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal menampilkan informasi.');
        }
    }

    async sendMainMenu(sock, from, msg) {
        const response = 
`📚 *REFERENSI JARINGAN*

📝 *Cara Pakai:*
\`.netinfo <topik>\`

📖 *TOPIK TERSEDIA*
• \`osi\` - Model OSI Layer
• \`tcpip\` - Model TCP/IP
• \`subnetting\` - Panduan Subnet
• \`ipclass\` - Kelas IP Address
• \`cable\` - Jenis Kabel Jaringan
• \`topology\` - Topologi Jaringan
• \`command\` - Perintah Network
• \`wifi\` - Standar WiFi
• \`binary\` - Konversi Biner

💡 *Contoh:*
\`.netinfo osi\`
\`.netinfo subnetting\`

🔧 *Tools Lainnya:*
• \`.subnet 192.168.1.0/24\`
• \`.ipinfo 8.8.8.8\`
• \`.dns google.com\`
• \`.port 22\``;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '📚');
    }

    getOSIModel() {
        return `🌐 *MODEL OSI 7 LAYER*

🔼 *Dari Atas ke Bawah:*

7️⃣ *Application Layer*
   - HTTP, FTP, SMTP, DNS
   - Interaksi langsung user

6️⃣ *Presentation Layer*
   - SSL/TLS, JPEG, ASCII
   - Enkripsi & format data

5️⃣ *Session Layer*
   - NetBIOS, RPC
   - Manajemen koneksi

4️⃣ *Transport Layer*
   - TCP, UDP
   - Port numbers, segmentasi

3️⃣ *Network Layer*
   - IP, ICMP, ARP
   - Routing, IP Address

2️⃣ *Data Link Layer*
   - Ethernet, MAC Address
   - Frame, Switch

1️⃣ *Physical Layer*
   - Kabel, Hub, Fiber
   - Bits, sinyal listrik

💡 *Tips Hafal:*
_All People Seem To Need Data Processing_`;
    }

    getTCPIPModel() {
        return `🌐 *MODEL TCP/IP 4 LAYER*

4️⃣ *Application Layer*
   - HTTP, FTP, SMTP, DNS, SSH
   - = OSI Layer 5, 6, 7

3️⃣ *Transport Layer*
   - TCP (reliable)
   - UDP (fast, unreliable)
   - = OSI Layer 4

2️⃣ *Internet Layer*
   - IP, ICMP, ARP
   - Routing antar network
   - = OSI Layer 3

1️⃣ *Network Access Layer*
   - Ethernet, Wi-Fi
   - = OSI Layer 1, 2

📊 *TCP vs UDP*
TCP:
• Reliable, Ordered
• Error check, Connection
• HTTP, SSH

UDP:
• Unreliable, No order
• Fast, Connectionless
• DNS, Video`;
    }

    getSubnettingGuide() {
        return `📊 *PANDUAN SUBNETTING*

🔢 *Tabel CIDR*
• /8 - 255.0.0.0 - 16,777,214 hosts
• /16 - 255.255.0.0 - 65,534 hosts
• /24 - 255.255.255.0 - 254 hosts
• /25 - 255.255.255.128 - 126 hosts
• /26 - 255.255.255.192 - 62 hosts
• /27 - 255.255.255.224 - 30 hosts
• /28 - 255.255.255.240 - 14 hosts
• /29 - 255.255.255.248 - 6 hosts
• /30 - 255.255.255.252 - 2 hosts
• /31 - 255.255.255.254 - 2 hosts*
• /32 - 255.255.255.255 - 1 host

📝 *Rumus:*
• Total IP = 2^(32-CIDR)
• Usable = Total - 2
• Network = IP pertama
• Broadcast = IP terakhir

💡 *Magic Number:*
256 - subnet mask oktet = increment

📌 *Contoh /26:*
256 - 192 = 64 (increment)
0, 64, 128, 192 (network addresses)`;
    }

    getCableTypes() {
        return `🔌 *JENIS KABEL JARINGAN*

📡 *UTP (Unshielded Twisted Pair)*
• Cat5 - 100 Mbps - 100m
• Cat5e - 1 Gbps - 100m
• Cat6 - 10 Gbps - 55m
• Cat6a - 10 Gbps - 100m
• Cat7 - 10 Gbps - 100m (STP)
• Cat8 - 40 Gbps - 30m

🔗 *Susunan Kabel*

*Straight-Through:* (PC ke Switch)
1. Putih-Oren
2. Oren
3. Putih-Hijau
4. Biru
5. Putih-Biru
6. Hijau
7. Putih-Coklat
8. Coklat

*Crossover:* (PC ke PC)
• Pin 1,2 tukar dengan Pin 3,6

🌈 *Fiber Optic:*
• Single Mode: jarak jauh
• Multi Mode: jarak pendek`;
    }

    getIPClasses() {
        return `🏷️ *KELAS IP ADDRESS*

📊 *Klasifikasi IP*
• Class A: 1-126, /8 (255.0.0.0)
• Class B: 128-191, /16 (255.255.0.0)
• Class C: 192-223, /24 (255.255.255.0)
• Class D: 224-239, Multicast
• Class E: 240-255, Reserved

🔒 *IP Private (RFC 1918)*
• Class A: 10.0.0.0/8
• Class B: 172.16.0.0/12
• Class C: 192.168.0.0/16

🌐 *IP Khusus*
• 127.0.0.0/8 - Loopback
• 169.254.0.0/16 - APIPA
• 0.0.0.0 - Default route
• 255.255.255.255 - Broadcast`;
    }

    getNetworkCommands() {
        return `💻 *PERINTAH JARINGAN*

🪟 *Windows*
• ipconfig - Lihat IP config
• ipconfig /all - Detail lengkap
• ipconfig /release - Lepas IP
• ipconfig /renew - Minta IP baru
• ping <host> - Test koneksi
• tracert <host> - Trace route
• nslookup <domain> - DNS lookup
• netstat -an - Koneksi aktif
• arp -a - Tabel ARP
• route print - Routing table

🐧 *Linux*
• ip addr - Lihat IP
• ip route - Routing table
• ping <host> - Test koneksi
• traceroute <host> - Trace route
• dig <domain> - DNS lookup
• netstat -tulpn - Port listening
• ss -tulpn - Socket stats
• nmap <host> - Port scan
• tcpdump - Capture packet
• ifconfig - Legacy IP config

📶 *Cisco Router*
• show ip route - Routing table
• show interfaces - Status interface
• show running-config - Config aktif`;
    }

    getTopologies() {
        return `🌐 *TOPOLOGI JARINGAN*

📊 *Jenis Topologi:*

🔵 *Bus Topology*
[PC]-[PC]-[PC]-[PC]
- Sederhana, murah
- Satu rusak = semua down

⭐ *Star Topology*
    [PC]
      |
[PC]-[HUB]-[PC]
      |
    [PC]
- Mudah troubleshoot
- Satu rusak tidak ganggu
- Tergantung hub/switch

🔄 *Ring Topology*
  [PC]--[PC]
   |      |
  [PC]--[PC]
- Data mengalir satu arah
- Satu rusak = putus ring

🕸️ *Mesh Topology*
[PC]==[PC]
 | X |
[PC]==[PC]
- Redundant, reliable
- Mahal, kompleks

🌲 *Tree Topology*
      [Root]
      /    \\
   [SW]    [SW]
   / \\     / \\
[PC][PC][PC][PC]
- Hierarki, scalable`;
    }

    getWiFiStandards() {
        return `📶 *STANDAR WiFi*

📊 *Evolusi WiFi*
• WiFi 1 (802.11b): 11 Mbps, 2.4GHz
• WiFi 2 (802.11a): 54 Mbps, 5GHz
• WiFi 3 (802.11g): 54 Mbps, 2.4GHz
• WiFi 4 (802.11n): 600 Mbps, 2.4/5GHz
• WiFi 5 (802.11ac): 6.9 Gbps, 5GHz
• WiFi 6 (802.11ax): 9.6 Gbps, 2.4/5GHz
• WiFi 6E (802.11ax): 9.6 Gbps, 6GHz
• WiFi 7 (802.11be): 46 Gbps, 2.4/5/6GHz

📡 *Frekuensi*
• 2.4 GHz: Jarak jauh, lambat
• 5 GHz: Cepat, jarak pendek
• 6 GHz: Lebih cepat, baru

🔐 *Keamanan*
• WEP: Tidak aman
• WPA: Sudah lemah
• WPA2: Standar
• WPA3: Terbaru, aman`;
    }

    getBinaryConversion() {
        return `🔢 *KONVERSI BINER*

📊 *Tabel Nilai Bit*
Bit: 7  6  5  4  3  2  1  0
Val: 128 64 32 16 8  4  2  1

📝 *Contoh Konversi*

*Desimal ke Biner:*
• 192 = 128+64 = 11000000
• 168 = 128+32+8 = 10101000
• 255 = 11111111
• 0 = 00000000

*IP Address:*
192.168.1.1 =
11000000.10101000.00000001.00000001

*Subnet Mask:*
/24 = 255.255.255.0 =
11111111.11111111.11111111.00000000

💡 *Tips:*
• 8 bit = 1 byte = 1 oktet
• Max value 8 bit = 255
• IP = 32 bit (4 oktet)

🧮 *Hex Conversion*
• 0-9 = 0-9
• 10 = A, 11 = B, 12 = C
• 13 = D, 14 = E, 15 = F
• 192 = C0, 168 = A8`;
    }
}

module.exports = NetInfoCommand;
