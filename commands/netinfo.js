/**
 * NetInfo Command
 * Cheat sheet dan referensi networking lengkap dalam Bahasa Indonesia
 */

const CommandBase = require('./base');

class NetInfoCommand extends CommandBase {
    constructor() {
        super({
            name: 'netinfo',
            aliases: ['network', 'netcheat', 'jaringan'],
            description: 'Cheat sheet dan referensi networking lengkap',
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
            'kelasip': this.getIPClasses.bind(this),
            'command': this.getNetworkCommands.bind(this),
            'perintah': this.getNetworkCommands.bind(this),
            'topology': this.getTopologies.bind(this),
            'topologi': this.getTopologies.bind(this),
            'wifi': this.getWiFiStandards.bind(this),
            'binary': this.getBinaryConversion.bind(this),
            'biner': this.getBinaryConversion.bind(this),
            'protocol': this.getProtocols.bind(this),
            'protokol': this.getProtocols.bind(this),
            'routing': this.getRoutingInfo.bind(this),
            'vlan': this.getVLANInfo.bind(this),
            'firewall': this.getFirewallInfo.bind(this),
            'nat': this.getNATInfo.bind(this),
            'dhcp': this.getDHCPInfo.bind(this),
            'vpn': this.getVPNInfo.bind(this),
            'troubleshoot': this.getTroubleshootGuide.bind(this),
            'ipv6': this.getIPv6Info.bind(this)
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
            const availableTopics = Object.keys(this.topics);
            return await this.reply(sock, from, msg, 
                `❌ Topik "${topic}" tidak ditemukan.\n\n` +
                `📖 *Topik tersedia:*\n` +
                `osi, tcpip, subnetting, kabel, kelasip, perintah, topologi, wifi, biner, protokol, routing, vlan, firewall, nat, dhcp, vpn, troubleshoot, ipv6`);
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
`📚 *REFERENSI JARINGAN KOMPUTER*

📝 *Cara Pakai:*
\`.netinfo <topik>\`

📖 *TOPIK DASAR*
• \`osi\` - Model OSI 7 Layer
• \`tcpip\` - Model TCP/IP
• \`subnetting\` - Panduan Subnet & CIDR
• \`kelasip\` - Kelas IP Address
• \`biner\` - Konversi Biner & Hex
• \`ipv6\` - Panduan IPv6

🔌 *INFRASTRUKTUR*
• \`kabel\` - Jenis Kabel Jaringan
• \`topologi\` - Topologi Jaringan
• \`wifi\` - Standar WiFi & Wireless

🔧 *TEKNOLOGI*
• \`protokol\` - Protokol Jaringan
• \`routing\` - Routing & Gateway
• \`vlan\` - Virtual LAN
• \`nat\` - Network Address Translation
• \`dhcp\` - DHCP Server/Client
• \`vpn\` - Virtual Private Network
• \`firewall\` - Firewall & ACL

💻 *PRAKTIS*
• \`perintah\` - Command Line Network
• \`troubleshoot\` - Troubleshooting

💡 *Contoh:*
\`.netinfo osi\`
\`.netinfo subnetting\`
\`.netinfo troubleshoot\`

🔧 *Tools Praktis:*
• \`.subnet 192.168.1.0/24\`
• \`.ipinfo 8.8.8.8\`
• \`.dns google.com\`
• \`.port 22\``;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '📚');
    }

    getOSIModel() {
        return `🌐 *MODEL OSI 7 LAYER*
_Open Systems Interconnection_

📌 *Fungsi Setiap Layer:*

7️⃣ *Application Layer (Lapisan 7)*
   📋 Fungsi: Interaksi langsung dengan user
   📡 Protokol: HTTP, HTTPS, FTP, SMTP, POP3, IMAP, DNS, DHCP, Telnet, SSH, SNMP
   📦 Data Unit: Data
   🔧 Contoh: Browser, Email client, FTP client

6️⃣ *Presentation Layer (Lapisan 6)*
   📋 Fungsi: Format, enkripsi, kompresi data
   📡 Protokol: SSL/TLS, JPEG, MPEG, GIF, ASCII, EBCDIC
   📦 Data Unit: Data
   🔧 Contoh: Enkripsi HTTPS, format gambar

5️⃣ *Session Layer (Lapisan 5)*
   📋 Fungsi: Membangun, mengelola, mengakhiri sesi
   📡 Protokol: NetBIOS, RPC, PPTP, SAP, SCP
   📦 Data Unit: Data
   🔧 Contoh: Login session, video conference

4️⃣ *Transport Layer (Lapisan 4)*
   📋 Fungsi: Segmentasi, flow control, error recovery
   📡 Protokol: TCP (reliable), UDP (fast)
   📦 Data Unit: Segment (TCP) / Datagram (UDP)
   🔧 Contoh: Port numbers (80, 443, 22)

3️⃣ *Network Layer (Lapisan 3)*
   📋 Fungsi: Routing, logical addressing
   📡 Protokol: IP, ICMP, ARP, RARP, IGMP
   🔧 Perangkat: Router, Layer 3 Switch
   📦 Data Unit: Packet

2️⃣ *Data Link Layer (Lapisan 2)*
   📋 Fungsi: Physical addressing, frame
   📡 Protokol: Ethernet, PPP, HDLC, Frame Relay
   🔧 Perangkat: Switch, Bridge, NIC
   📦 Data Unit: Frame

1️⃣ *Physical Layer (Lapisan 1)*
   📋 Fungsi: Transmisi bit melalui media
   📡 Standar: RS-232, V.35, 802.11
   🔧 Perangkat: Hub, Repeater, Kabel, Fiber
   📦 Data Unit: Bits

💡 *Tips Hafal (Atas-Bawah):*
_All People Seem To Need Data Processing_

💡 *Tips Hafal (Bawah-Atas):*
_Please Do Not Throw Sausage Pizza Away_

📊 *Enkapsulasi Data:*
Data → Segment → Packet → Frame → Bits`;
    }

    getTCPIPModel() {
        return `🌐 *MODEL TCP/IP 4 LAYER*
_Transmission Control Protocol/Internet Protocol_

📌 *Perbandingan dengan OSI:*

4️⃣ *Application Layer*
   📋 Fungsi: Layanan user dan aplikasi
   📡 Protokol: HTTP, FTP, SMTP, DNS, SSH, Telnet, SNMP, DHCP
   🔄 OSI Equivalent: Layer 5, 6, 7

3️⃣ *Transport Layer*
   📋 Fungsi: End-to-end communication
   📡 Protokol: TCP, UDP
   🔄 OSI Equivalent: Layer 4

2️⃣ *Internet Layer*
   📋 Fungsi: Routing dan logical addressing
   📡 Protokol: IP, ICMP, ARP, RARP
   🔄 OSI Equivalent: Layer 3

1️⃣ *Network Access Layer*
   📋 Fungsi: Hardware dan media transmisi
   📡 Protokol: Ethernet, Wi-Fi, PPP
   🔄 OSI Equivalent: Layer 1, 2

📊 *TCP vs UDP*

*TCP (Transmission Control Protocol):*
✅ Connection-oriented (3-way handshake)
✅ Reliable delivery (acknowledgment)
✅ Ordered delivery (sequence number)
✅ Error checking & flow control
📌 Port: HTTP(80), HTTPS(443), FTP(21), SSH(22), SMTP(25)
⚡ Lebih lambat, tapi data terjamin

*UDP (User Datagram Protocol):*
❌ Connectionless
❌ No guarantee delivery
❌ No ordering
✅ Low overhead, fast
📌 Port: DNS(53), DHCP(67/68), TFTP(69), SNMP(161)
⚡ Lebih cepat untuk streaming, gaming, VoIP

📊 *3-Way Handshake TCP:*
1️⃣ Client → SYN → Server
2️⃣ Server → SYN-ACK → Client
3️⃣ Client → ACK → Server
✅ Koneksi established!

📊 *4-Way Termination TCP:*
1️⃣ Client → FIN → Server
2️⃣ Server → ACK → Client
3️⃣ Server → FIN → Client
4️⃣ Client → ACK → Server
✅ Koneksi terminated!`;
    }

    getSubnettingGuide() {
        return `📊 *PANDUAN SUBNETTING LENGKAP*

🔢 *Tabel CIDR*

📌 *Class A (/8-/15)*
• /8 → 255.0.0.0 → 16.7 juta host
• /9 → 255.128.0.0 → 8.3 juta host
• /10 → 255.192.0.0 → 4.1 juta host
• /11 → 255.224.0.0 → 2 juta host
• /12 → 255.240.0.0 → 1 juta host
• /13 → 255.248.0.0 → 524K host
• /14 → 255.252.0.0 → 262K host
• /15 → 255.254.0.0 → 131K host

📌 *Class B (/16-/23)*
• /16 → 255.255.0.0 → 65,534 host
• /17 → 255.255.128.0 → 32,766 host
• /18 → 255.255.192.0 → 16,382 host
• /19 → 255.255.224.0 → 8,190 host
• /20 → 255.255.240.0 → 4,094 host
• /21 → 255.255.248.0 → 2,046 host
• /22 → 255.255.252.0 → 1,022 host
• /23 → 255.255.254.0 → 510 host

📌 *Class C (/24-/32)*
• /24 → 255.255.255.0 → 254 host
• /25 → 255.255.255.128 → 126 host
• /26 → 255.255.255.192 → 62 host
• /27 → 255.255.255.224 → 30 host
• /28 → 255.255.255.240 → 14 host
• /29 → 255.255.255.248 → 6 host
• /30 → 255.255.255.252 → 2 host
• /31 → 255.255.255.254 → 2 (P2P)
• /32 → 255.255.255.255 → 1 host

📝 *Rumus Penting:*
• Total IP = 2^(32-CIDR)
• Usable Host = Total IP - 2
• Network Address = IP pertama
• Broadcast = IP terakhir
• Gateway = biasanya .1 atau .254

💡 *Metode Magic Number:*
256 - nilai oktet subnet = increment

📌 *Contoh Perhitungan /26:*
• Subnet: 255.255.255.192
• 256 - 192 = 64 (increment)
• Network: 0, 64, 128, 192
• Range .0: 0-63 (usable 1-62)
• Range .64: 64-127 (usable 65-126)
• Range .128: 128-191 (usable 129-190)
• Range .192: 192-255 (usable 193-254)

🧮 *VLSM (Variable Length Subnet Mask):*
Teknik membagi subnet dengan ukuran berbeda sesuai kebutuhan untuk menghemat IP.

📊 *Gunakan tools:*
\`.subnet 192.168.1.0/24\``;
    }

    getCableTypes() {
        return `🔌 *JENIS KABEL JARINGAN LENGKAP*

📡 *UTP (Unshielded Twisted Pair)*

🔹 *Cat3* → 10Mbps, 100m, 16MHz
🔹 *Cat5* → 100Mbps, 100m, 100MHz
🔹 *Cat5e* → 1Gbps, 100m, 100MHz
🔹 *Cat6* → 10Gbps, 55m, 250MHz
🔹 *Cat6a* → 10Gbps, 100m, 500MHz
🔹 *Cat7* → 10Gbps, 100m, 600MHz
🔹 *Cat8* → 40Gbps, 30m, 2GHz

🔗 *Susunan Kabel T568A:*
1. Putih-Hijau
2. Hijau
3. Putih-Oren
4. Biru
5. Putih-Biru
6. Oren
7. Putih-Coklat
8. Coklat

🔗 *Susunan Kabel T568B:*
1. Putih-Oren
2. Oren
3. Putih-Hijau
4. Biru
5. Putih-Biru
6. Hijau
7. Putih-Coklat
8. Coklat

📌 *Jenis Koneksi:*
• *Straight-Through:* T568B - T568B
  → PC ke Switch/Hub
  → Router ke Switch/Hub
  
• *Crossover:* T568A - T568B
  → PC ke PC
  → Switch ke Switch
  → Router ke Router

• *Rollover/Console:* Terbalik
  → PC ke Router Console

🌈 *Fiber Optic:*
• *Single Mode (SMF):*
  - Core: 8-10 micron
  - Jarak: sampai 100km
  - Warna: Kuning
  
• *Multi Mode (MMF):*
  - Core: 50-62.5 micron
  - Jarak: sampai 2km
  - Warna: Oranye/Aqua

📡 *Konektor:*
• RJ-45: UTP/STP
• LC/SC/ST: Fiber Optic
• RJ-11: Telepon`;
    }

    getIPClasses() {
        return `🏷️ *KELAS IP ADDRESS LENGKAP*

📊 *Klasifikasi IP (Classful)*

🔷 *Class A* (1-126)
   • CIDR: /8
   • Host: 16,777,214
   • Untuk: Organisasi besar

🔷 *Class B* (128-191)
   • CIDR: /16
   • Host: 65,534
   • Untuk: Perusahaan menengah

🔷 *Class C* (192-223)
   • CIDR: /24
   • Host: 254
   • Untuk: Jaringan kecil/SOHO

🔷 *Class D* (224-239)
   • Untuk: Multicast

🔷 *Class E* (240-255)
   • Untuk: Experimental

🔒 *IP Private (RFC 1918)*
Tidak bisa diakses langsung dari internet:
• Class A: 10.0.0.0 - 10.255.255.255 (/8)
• Class B: 172.16.0.0 - 172.31.255.255 (/12)
• Class C: 192.168.0.0 - 192.168.255.255 (/16)

🌐 *IP Address Khusus:*
• 0.0.0.0/8 - Network ini
• 127.0.0.0/8 - Loopback (localhost)
• 169.254.0.0/16 - APIPA (Auto IP)
• 192.0.2.0/24 - Dokumentasi
• 198.51.100.0/24 - Dokumentasi
• 203.0.113.0/24 - Dokumentasi
• 224.0.0.0/4 - Multicast
• 240.0.0.0/4 - Reserved
• 255.255.255.255 - Broadcast

📡 *Multicast Address:*
• 224.0.0.1 - All hosts
• 224.0.0.2 - All routers
• 224.0.0.5 - OSPF routers
• 224.0.0.6 - OSPF DR routers
• 224.0.0.9 - RIPv2 routers
• 224.0.0.10 - EIGRP routers

💡 *CIDR (Classless Inter-Domain Routing):*
Menggantikan sistem classful untuk efisiensi penggunaan IP address.`;
    }

    getNetworkCommands() {
        return `💻 *PERINTAH JARINGAN LENGKAP*

🪟 *Windows Command Prompt*
• ipconfig - Lihat konfigurasi IP
• ipconfig /all - Detail lengkap adapter
• ipconfig /release - Lepas IP DHCP
• ipconfig /renew - Minta IP baru
• ipconfig /flushdns - Hapus cache DNS
• ipconfig /displaydns - Lihat cache DNS

• ping <host> - Test koneksi (ICMP)
• ping -t <host> - Ping terus menerus
• ping -n 10 <host> - Ping 10 kali
• pathping <host> - Kombinasi ping+tracert

• tracert <host> - Trace route ke host
• netstat -an - Semua koneksi aktif
• netstat -b - Koneksi dengan aplikasi
• netstat -o - Koneksi dengan PID

• nslookup <domain> - Query DNS
• arp -a - Lihat tabel ARP
• arp -d - Hapus cache ARP
• route print - Lihat routing table
• route add - Tambah static route

• netsh wlan show profiles - Lihat WiFi
• netsh wlan show networks - Scan WiFi
• nbtstat -n - NetBIOS local
• hostname - Lihat nama komputer

🐧 *Linux Command*
• ip addr / ip a - Lihat IP
• ip link - Status interface
• ip route / ip r - Routing table
• ip neigh - Tabel ARP

• ifconfig - Legacy IP config
• ping <host> - Test koneksi
• traceroute <host> - Trace route
• mtr <host> - Realtime traceroute

• dig <domain> - DNS lookup detail
• nslookup <domain> - DNS query
• host <domain> - DNS lookup simple

• netstat -tulpn - Port listening
• ss -tulpn - Socket statistics
• lsof -i - Open network files

• nmap <host> - Port scan
• tcpdump - Packet capture
• iptables -L - Lihat firewall rules
• curl/wget - HTTP request

📶 *Cisco IOS*
• show ip route - Routing table
• show ip interface brief - Status interface
• show running-config - Config aktif
• show startup-config - Config tersimpan
• show vlan brief - Daftar VLAN
• show mac address-table - MAC table
• show arp - Tabel ARP`;
    }

    getTopologies() {
        return `🌐 *TOPOLOGI JARINGAN LENGKAP*

🔵 *BUS TOPOLOGY*
📐 Bentuk: Semua perangkat terhubung ke satu kabel utama (backbone)
✅ Kelebihan: Murah, sederhana
❌ Kekurangan: Satu rusak = semua down
📌 Media: Coaxial cable

⭐ *STAR TOPOLOGY*
📐 Bentuk: Semua perangkat terhubung ke switch/hub pusat
✅ Kelebihan: Mudah troubleshoot, scalable
❌ Kekurangan: Tergantung switch/hub
📌 Media: UTP, Fiber
📌 Paling umum digunakan!

🔄 *RING TOPOLOGY*
📐 Bentuk: Perangkat membentuk lingkaran tertutup
✅ Kelebihan: Equal access, token passing
❌ Kekurangan: Satu rusak = ring putus
📌 Contoh: Token Ring, FDDI

🕸️ *MESH TOPOLOGY*
📐 Bentuk: Setiap perangkat terhubung ke semua perangkat lain
✅ Kelebihan: Redundant, reliable
❌ Kekurangan: Mahal, kompleks
📌 Jenis: Full Mesh, Partial Mesh
📌 Digunakan: WAN, ISP backbone

🌲 *TREE/HIERARCHICAL TOPOLOGY*
📐 Bentuk: Struktur bertingkat (Core → Distribution → Access)
✅ Kelebihan: Scalable, hierarki jelas
❌ Kekurangan: Backbone rusak = fatal
📌 3 Layer: Core, Distribution, Access

🔀 *HYBRID TOPOLOGY*
Kombinasi dari beberapa topologi untuk fleksibilitas dan skalabilitas.

📊 *Star-Bus:* Star + Bus
📊 *Star-Ring:* Star + Ring`;
    }

    getWiFiStandards() {
        return `📶 *STANDAR WiFi LENGKAP*

📊 *Evolusi WiFi*

📻 *WiFi 1* (802.11b)
   • Max: 11Mbps @ 2.4GHz
   • Tahun: 1999

📻 *WiFi 2* (802.11a)
   • Max: 54Mbps @ 5GHz
   • Tahun: 1999

📻 *WiFi 3* (802.11g)
   • Max: 54Mbps @ 2.4GHz
   • Tahun: 2003

📻 *WiFi 4* (802.11n)
   • Max: 600Mbps @ 2.4/5GHz
   • Tahun: 2009

📻 *WiFi 5* (802.11ac)
   • Max: 6.9Gbps @ 5GHz
   • Tahun: 2014

📻 *WiFi 6* (802.11ax)
   • Max: 9.6Gbps @ 2.4/5GHz
   • Tahun: 2019

📻 *WiFi 6E* (802.11ax)
   • Max: 9.6Gbps @ 6GHz
   • Tahun: 2021

📻 *WiFi 7* (802.11be)
   • Max: 46Gbps @ 2.4/5/6GHz
   • Tahun: 2024

📡 *Perbandingan Frekuensi:*
• *2.4 GHz:*
  - Jangkauan lebih jauh
  - Tembus dinding lebih baik
  - Lebih banyak interferensi
  - Channels: 1, 6, 11 (non-overlap)

• *5 GHz:*
  - Kecepatan lebih tinggi
  - Jangkauan lebih pendek
  - Lebih sedikit interferensi
  - Lebih banyak channel

• *6 GHz:*
  - Bandwidth sangat luas
  - Minimal interferensi
  - Terbaru dan tercepat

🔐 *Keamanan WiFi:*
• *WEP:* ❌ Tidak aman, mudah dicrack
• *WPA:* ⚠️ Sudah lemah, TKIP
• *WPA2:* ✅ Standar saat ini, AES
• *WPA3:* ✅ Terbaru, SAE, paling aman

📌 *Teknologi WiFi 6:*
• OFDMA: Multiple users 1 channel
• MU-MIMO: Multiple Input/Output
• BSS Coloring: Reduce interference
• Target Wake Time: Hemat baterai
• 1024-QAM: Higher data density`;
    }

    getBinaryConversion() {
        return `🔢 *KONVERSI BINER & HEKSADESIMAL*

📊 *Tabel Nilai Bit (8-bit)*
Posisi 7→0: 128, 64, 32, 16, 8, 4, 2, 1

📝 *Konversi Desimal ke Biner:*
• 192 = 128+64 = 11000000
• 168 = 128+32+8 = 10101000
• 255 = semua bit 1 = 11111111
• 128 = 10000000
• 64 = 01000000
• 32 = 00100000
• 0 = 00000000

📝 *Konversi Biner ke Desimal:*
11001010 = 128+64+8+2 = 202

🌐 *IP Address dalam Biner:*
192.168.1.1 =
11000000.10101000.00000001.00000001

🎭 *Subnet Mask dalam Biner:*
• /24 = 255.255.255.0
  11111111.11111111.11111111.00000000
  
• /25 = 255.255.255.128
  11111111.11111111.11111111.10000000
  
• /26 = 255.255.255.192
  11111111.11111111.11111111.11000000

🧮 *Konversi Heksadesimal:*

0 = 0 | 8 = 8
1 = 1 | 9 = 9
2 = 2 | 10 = A
3 = 3 | 11 = B
4 = 4 | 12 = C
5 = 5 | 13 = D
6 = 6 | 14 = E
7 = 7 | 15 = F

📌 *Contoh IP ke Hex:*
192 = C0 (12×16+0)
168 = A8 (10×16+8)
1 = 01
1 = 01
192.168.1.1 = C0.A8.01.01

📌 *MAC Address (48-bit):*
AA:BB:CC:DD:EE:FF
• 6 oktet heksadesimal
• 3 byte pertama = OUI (vendor)
• 3 byte terakhir = unique ID`;
    }

    getProtocols() {
        return `📡 *PROTOKOL JARINGAN LENGKAP*

🌐 *Layer 7 - Application*
• HTTP (80): Web browsing
• HTTPS (443): Web aman (SSL/TLS)
• FTP (21): Transfer file
• SFTP (22): FTP terenkripsi
• SSH (22): Remote login aman
• Telnet (23): Remote login (tidak aman!)
• SMTP (25/587): Kirim email
• POP3 (110): Terima email (download)
• IMAP (143): Terima email (sync)
• DNS (53): Domain to IP
• DHCP (67/68): IP otomatis
• SNMP (161/162): Network management
• NTP (123): Sinkronisasi waktu
• TFTP (69): Simple file transfer

🔒 *Security Protocols*
• SSL/TLS: Enkripsi transport
• IPSec: Enkripsi network layer
• SSH: Secure Shell
• HTTPS: HTTP + SSL/TLS

📡 *Layer 4 - Transport*
• TCP: Reliable, connection-oriented
• UDP: Fast, connectionless
• SCTP: Stream control

🌐 *Layer 3 - Network*
• IP: Logical addressing
• ICMP: Ping, error messages
• ARP: IP to MAC address
• RARP: MAC to IP address
• IGMP: Multicast management

📡 *Routing Protocols*
• RIP: Distance vector, hop count
• OSPF: Link state, cost
• EIGRP: Hybrid, Cisco proprietary
• BGP: Internet backbone routing
• IS-IS: Link state, large networks

🔗 *Layer 2 - Data Link*
• Ethernet: LAN standard
• PPP: Point-to-Point
• HDLC: WAN protocol
• Frame Relay: Legacy WAN
• MPLS: Multi-protocol switching

📊 *Protocol Number:*
• ICMP: 1
• TCP: 6
• UDP: 17
• GRE: 47
• ESP: 50
• AH: 51
• OSPF: 89`;
    }

    getRoutingInfo() {
        return `🔀 *ROUTING & GATEWAY*

📌 *Konsep Dasar:*
• Router: Perangkat yang menghubungkan network berbeda
• Gateway: Pintu keluar network ke network lain
• Routing Table: Daftar rute ke network tujuan
• Metric: Nilai untuk memilih rute terbaik

📊 *Jenis Routing:*

*1. Static Routing:*
✅ Dikonfigurasi manual
✅ Cocok untuk network kecil
❌ Tidak scalable
❌ Tidak adaptif

*2. Dynamic Routing:*
✅ Otomatis update
✅ Scalable, adaptif
❌ Lebih kompleks
❌ Butuh resource lebih

📡 *Routing Protocols:*

*Distance Vector:*
• RIP (Routing Information Protocol)
  - Metric: Hop count
  - Max hop: 15
  - Update: 30 detik
  
*Link State:*
• OSPF (Open Shortest Path First)
  - Metric: Cost (bandwidth)
  - Area-based
  - Fast convergence
  
• IS-IS (Intermediate System)
  - Similar to OSPF
  - Used by ISPs

*Hybrid:*
• EIGRP (Enhanced IGRP)
  - Cisco proprietary
  - Metric: Bandwidth, delay, load, reliability
  - Fast convergence

*Path Vector:*
• BGP (Border Gateway Protocol)
  - Internet backbone
  - AS path
  - Policy-based

📊 *Administrative Distance:*

🔹 Connected → AD: 0
🔹 Static → AD: 1
🔹 EIGRP Summary → AD: 5
🔹 eBGP → AD: 20
🔹 EIGRP → AD: 90
🔹 OSPF → AD: 110
🔹 IS-IS → AD: 115
🔹 RIP → AD: 120
🔹 iBGP → AD: 200

💡 *Tip:* AD lebih kecil = prioritas lebih tinggi`;
    }

    getVLANInfo() {
        return `🏷️ *VLAN (Virtual LAN)*

📌 *Apa itu VLAN?*
VLAN membagi switch fisik menjadi beberapa network logis. Device di VLAN berbeda tidak bisa berkomunikasi langsung.

✅ *Keuntungan VLAN:*
• Segmentasi network
• Keamanan lebih baik
• Broadcast domain terbatas
• Fleksibilitas design
• Reduce broadcast traffic

📊 *Jenis Port:*
• *Access Port:* 1 VLAN, untuk end device
• *Trunk Port:* Multiple VLAN, antar switch

📡 *VLAN Tagging (802.1Q):*
• Tag 4 byte ditambahkan ke frame
• TPID: 0x8100
• Priority: 3 bit (CoS)
• VLAN ID: 12 bit (1-4094)

📊 *VLAN Ranges:*
• 1: Default VLAN
• 2-1001: Normal range
• 1002-1005: Reserved (Token Ring)
• 1006-4094: Extended range

📌 *Native VLAN:*
• Untagged traffic di trunk
• Default: VLAN 1
• Harus sama di kedua sisi

📊 *Inter-VLAN Routing:*
1. *Router on a Stick:*
   - 1 interface router, sub-interface
   - Trunk ke router
   
2. *Layer 3 Switch:*
   - SVI (Switch Virtual Interface)
   - Lebih cepat

📝 *Contoh Konfigurasi:*

_Create VLAN:_
vlan 10
  name SALES

_Access port:_
interface Fa0/1
  switchport mode access
  switchport access vlan 10

_Trunk port:_
interface Gi0/1
  switchport mode trunk
  switchport trunk allowed vlan 10,20,30

🏷️ *VTP (VLAN Trunking Protocol):*
• Server: Buat, ubah, hapus VLAN
• Client: Terima info VLAN
• Transparent: Forward, tidak ikut`;
    }

    getFirewallInfo() {
        return `🔥 *FIREWALL & ACL*

📌 *Apa itu Firewall?*
Firewall adalah sistem keamanan yang mengontrol traffic network berdasarkan rules yang ditentukan.

📊 *Jenis Firewall:*

*1. Packet Filtering:*
• Filter berdasarkan header
• IP source/destination
• Port source/destination
• Stateless

*2. Stateful Inspection:*
• Track connection state
• Lebih aman dari packet filtering
• Performance lebih baik

*3. Application Layer:*
• Deep packet inspection
• Filter berdasarkan content
• Lebih aman tapi lambat

*4. Next-Gen Firewall (NGFW):*
• Deep packet inspection
• Application awareness
• User identity
• Intrusion prevention
• SSL inspection

📋 *ACL (Access Control List):*
Rules untuk filter traffic

*Standard ACL:*
• Filter by source IP only
• Nomor: 1-99, 1300-1999

*Extended ACL:*
• Filter by source, dest, port, protocol
• Nomor: 100-199, 2000-2699

📝 *ACL Logic:*
• Match → Action (permit/deny)
• No match → Next rule
• End → Implicit deny all

📌 *Contoh ACL:*

_Block specific host:_
access-list 1 deny 192.168.1.100
access-list 1 permit any

_Block web traffic:_
access-list 100 deny tcp any any eq 80
access-list 100 permit ip any any

_Apply to interface:_
interface Gi0/0
  ip access-group 100 in

🔒 *Firewall Zones:*
• Inside: Trusted network
• Outside: Untrusted (internet)
• DMZ: Semi-trusted (servers)

📊 *DMZ Best Practice:*
• Web server di DMZ
• Database di inside
• Firewall antara zones`;
    }

    getNATInfo() {
        return `🔄 *NAT (Network Address Translation)*

📌 *Apa itu NAT?*
NAT menerjemahkan IP private ke IP public agar bisa akses internet.

✅ *Keuntungan NAT:*
• Hemat IP public
• Sembunyikan IP internal
• Fleksibilitas design

📊 *Jenis NAT:*

*1. Static NAT:*
• 1 IP private = 1 IP public
• Untuk server yang perlu diakses dari luar

_Contoh:_
Inside: 192.168.1.10 ↔ Outside: 203.0.113.10

*2. Dynamic NAT:*
• Pool IP public
• First-come first-serve

_Contoh:_
Inside: 192.168.1.x ↔ Pool: 203.0.113.10-20

*3. PAT (Port Address Translation):*
• Many private = 1 public
• Dibedakan by port
• Juga disebut NAT Overload

_Contoh:_
192.168.1.10:1234 → 203.0.113.1:40001
192.168.1.20:5678 → 203.0.113.1:40002

📌 *NAT Terminology:*
• Inside Local: IP private internal
• Inside Global: IP public untuk internal
• Outside Local: IP untuk external (usually same as global)
• Outside Global: IP public external

📊 *Port Forwarding:*
Redirect traffic dari port tertentu ke server internal

_Web server:_
Outside:203.0.113.1:80 → Inside:192.168.1.10:80

_SSH server:_
Outside:203.0.113.1:22 → Inside:192.168.1.20:22

📌 *NAT Traversal:*
Masalah: Beberapa protokol sulit dengan NAT
• FTP (passive mode)
• VoIP/SIP
• IPSec
Solusi: NAT-T, STUN, TURN`;
    }

    getDHCPInfo() {
        return `📡 *DHCP (Dynamic Host Configuration Protocol)*

📌 *Apa itu DHCP?*
DHCP memberikan IP address dan network config secara otomatis ke client.

📋 *Info yang diberikan DHCP:*
• IP Address
• Subnet Mask
• Default Gateway
• DNS Server
• Domain Name
• Lease Time
• NTP Server (optional)

📊 *DHCP Process (DORA):*

1️⃣ *DISCOVER* (Client → Broadcast)
   "Siapa DHCP di network ini?"

2️⃣ *OFFER* (Server → Client)
   "Ini IP untukmu: 192.168.1.x"

3️⃣ *REQUEST* (Client → Broadcast)
   "Aku mau IP itu!"

4️⃣ *ACK* (Server → Client)
   "OK, pakai IP tersebut"

⏱️ *Lease Time:*
• Waktu pemakaian IP
• Default: 8 hari
• 50% = Renew attempt
• 87.5% = Rebind attempt
• 100% = Release, mulai DORA lagi

📊 *DHCP Pool:*
Range IP yang bisa diberikan

_Contoh:_
Pool: 192.168.1.100 - 192.168.1.200
Gateway: 192.168.1.1
DNS: 8.8.8.8
Lease: 7 days

📌 *DHCP Reservation:*
IP tetap berdasarkan MAC address

_Contoh:_
MAC: AA:BB:CC:DD:EE:FF
Reserved IP: 192.168.1.50

🔧 *DHCP Relay Agent:*
Forward DHCP ke server di network lain
(karena broadcast tidak lewat router)

📊 *DHCP Options:*
• Option 1: Subnet mask
• Option 3: Router (gateway)
• Option 6: DNS server
• Option 51: Lease time
• Option 53: Message type
• Option 66: TFTP server
• Option 150: TFTP server (Cisco)

⚠️ *DHCP Starvation Attack:*
Attacker request semua IP → pool habis
Solusi: DHCP Snooping, port security`;
    }

    getVPNInfo() {
        return `🔐 *VPN (Virtual Private Network)*

📌 *Apa itu VPN?*
VPN membuat koneksi aman (tunnel) melalui network public seperti internet.

✅ *Keuntungan VPN:*
• Enkripsi data
• Privacy & anonymity
• Akses resource remote
• Bypass geo-restriction

📊 *Jenis VPN:*

*1. Remote Access VPN:*
• User ke network
• Contoh: Kerja dari rumah
• Client: Windows, iOS, Android

*2. Site-to-Site VPN:*
• Network ke network
• Contoh: Kantor pusat ke cabang
• Device: Router, Firewall

📡 *VPN Protocols:*

*IPSec (Internet Protocol Security):*
• Layer 3 (Network)
• Tunnel mode & Transport mode
• IKE untuk key exchange
• ESP untuk enkripsi
• AH untuk authentication

*SSL/TLS VPN:*
• Layer 4-7
• HTTPS based
• Mudah (browser)
• Contoh: OpenVPN, Cisco AnyConnect

*WireGuard:*
• Modern, simple
• Fast, low overhead
• Strong cryptography

*L2TP/IPSec:*
• L2TP untuk tunnel
• IPSec untuk security
• Built-in di Windows/macOS

*PPTP:*
• ❌ Tidak aman, jangan digunakan
• Legacy protocol

📊 *IPSec Phases:*

*Phase 1 (IKE SA):*
• Authentication
• Key exchange
• Establish secure channel

*Phase 2 (IPSec SA):*
• Negotiate encryption
• Establish tunnel
• Data transfer

📌 *VPN Topology:*
• Hub-and-Spoke: Semua ke pusat
• Full Mesh: Semua ke semua
• Partial Mesh: Sebagian connected

🔐 *Encryption:*
• AES-256: Recommended
• 3DES: Legacy, masih OK
• DES: ❌ Tidak aman`;
    }

    getTroubleshootGuide() {
        return `🔧 *PANDUAN TROUBLESHOOTING JARINGAN*

📋 *Langkah Umum:*
1. Identifikasi masalah
2. Establish theory (hipotesis)
3. Test theory
4. Establish action plan
5. Implement solution
6. Verify & document

🔍 *Layer 1 - Physical:*
• Cek kabel tersambung?
• LED link menyala?
• Kabel rusak/patah?

_Perintah:_
• show interface (Cisco)
• ip link (Linux)
• Device Manager (Windows)

🔍 *Layer 2 - Data Link:*
• MAC address terdaftar?
• Port status up?
• VLAN benar?

_Perintah:_
• show mac address-table
• arp -a
• show vlan brief

🔍 *Layer 3 - Network:*
• IP address benar?
• Subnet mask benar?
• Gateway reachable?
• Routing benar?

_Perintah:_
• ping gateway
• tracert/traceroute
• show ip route
• ipconfig /all

🔍 *Layer 4-7 - Transport/App:*
• Port terbuka?
• Firewall blocking?
• Service running?
• DNS working?

_Perintah:_
• netstat -an
• telnet host port
• nslookup domain
• curl http://host

📊 *Flowchart Troubleshooting:*

1️⃣ Tidak bisa internet?
   ↓ Ping gateway
2️⃣ Fail? → Check IP/cable
   ↓ OK? → Ping IP public
3️⃣ Fail? → Check gateway
   ↓ OK? → DNS issue, gunakan nslookup

⚠️ *Common Issues:*
• IP conflict → Release/renew
• Wrong gateway → Check config
• DNS fail → Try 8.8.8.8
• Cable issue → Replace
• Port blocked → Check firewall
• VLAN wrong → Check config

🛠️ *Tools Berguna:*
• Ping - Basic connectivity
• Traceroute - Path to destination
• Nslookup/dig - DNS issues
• Netstat - Port & connections
• Wireshark - Packet analysis
• Nmap - Port scanning`;
    }

    getIPv6Info() {
        return `🌐 *IPv6 (Internet Protocol version 6)*

📌 *Kenapa IPv6?*
• IPv4 hampir habis (4.3 miliar)
• IPv6 = 340 undecillion address
• Built-in security (IPSec)
• Simplified header
• No NAT needed

📊 *Format IPv6:*
• 128-bit address
• 8 grup × 16 bit
• Hexadecimal
• Contoh: 2001:0db8:85a3:0000:0000:8a2e:0370:7334

📝 *Aturan Singkat:*
• Leading zeros bisa dihilangkan
• 0000 = 0
• Grup 0 berturut = :: (sekali saja)

Contoh:
• Full: 2001:0db8:0000:0000:0000:0000:0000:0001
• Short: 2001:db8::1

📊 *Jenis IPv6 Address:*

*Unicast:*
• Global Unicast: 2000::/3 (public)
• Link-Local: FE80::/10 (auto, 1 link)
• Unique Local: FC00::/7 (private)
• Loopback: ::1

*Multicast:*
• FF00::/8
• FF02::1 - All nodes
• FF02::2 - All routers

*Anycast:*
• Same as unicast format
• Multiple hosts, nearest response

📊 *IPv6 vs IPv4:*

🔹 *Address*
   IPv4: 32-bit | IPv6: 128-bit

🔹 *Format*
   IPv4: Decimal | IPv6: Hexadecimal

🔹 *Header*
   IPv4: Variable | IPv6: Fixed 40B

🔹 *NAT*
   IPv4: Required | IPv6: Not needed

🔹 *IPSec*
   IPv4: Optional | IPv6: Mandatory

🔹 *Broadcast*
   IPv4: Yes | IPv6: No (multicast)

🔹 *DHCP*
   IPv4: DHCPv4 | IPv6: DHCPv6/SLAAC

📡 *Auto-Configuration:*
• SLAAC: Stateless Auto-Config
• DHCPv6: Stateful
• EUI-64: MAC to IPv6

📌 *Prefix Notation:*
• /64 - Standard subnet (host portion)
• /48 - Site (65,536 subnets)
• /32 - ISP allocation

📊 *Transition Methods:*
• Dual Stack: IPv4 + IPv6
• Tunneling: 6to4, Teredo
• Translation: NAT64`;
    }
}

module.exports = NetInfoCommand;
