# HamBot Update Report

**Date:** February 1, 2025  
**Version:** 2.4.1  
**Author:** GitHub Copilot AI

---

## 📋 Ringkasan Perubahan (v2.4.1)

Update ini memperbaiki masalah `BOT_OWNER_ID` dengan WhatsApp Linked ID format (@lid):

1. **Dukungan Format @lid** - Bot sekarang menerima owner ID dalam format `@lid` atau `@s.whatsapp.net`
2. **Matching Langsung** - Pengecekan owner menggunakan direct matching untuk kedua format
3. **Dokumentasi Lengkap** - `.env.example` diperbarui dengan contoh kedua format

---

## 🔄 Perubahan Detail (v2.4.1)

### 1. Dukungan Format Linked ID (@lid)

**Masalah:**
WhatsApp kini menggunakan format `@lid` (Linked ID) untuk privasi pengguna, terutama di grup. Bot tidak bisa mengenali owner ketika sender menggunakan format `@lid` karena kode sebelumnya menolak format ini.

Contoh dari log:
```
sender: "12345678901234@lid"
```

**Solusi:**
Memperbarui `config.js` untuk menerima dan mencocokkan kedua format:

#### Update `_normalizeOwnerId()` Method

```javascript
_normalizeOwnerId(ownerId) {
    if (!ownerId) return null;
    
    let normalized = ownerId.trim();
    
    // Accept both @s.whatsapp.net and @lid formats directly
    if (normalized.endsWith('@s.whatsapp.net') || normalized.endsWith('@lid')) {
        return normalized;
    }
    
    // Assume phone number - normalize and add @s.whatsapp.net suffix
    const number = normalized.replace(/\D/g, '');
    if (!number) return null;
    
    return `${number}@s.whatsapp.net`;
}
```

**Perubahan Kunci:**
- Tidak lagi menolak format `@lid` dengan warning
- Menerima `@lid` sebagai format valid bersama `@s.whatsapp.net`
- Format nomor telepon tetap di-normalize ke `@s.whatsapp.net`

#### Update `isOwner()` Method

```javascript
isOwner(senderId) {
    if (!this.bot.ownerId || !senderId) return false;
    
    // Direct match (works for both @lid and @s.whatsapp.net)
    if (senderId === this.bot.ownerId) {
        return true;
    }
    
    // If owner uses @s.whatsapp.net format, try to normalize sender
    if (this.bot.ownerId.endsWith('@s.whatsapp.net')) {
        let normalizedSender = senderId;
        
        // If sender uses @lid format, cannot match with @s.whatsapp.net
        if (senderId.endsWith('@lid')) {
            return false;
        }
        
        // If sender is in participant format (group), extract JID
        if (senderId.includes(':')) {
            normalizedSender = senderId.split(':')[0] + '@s.whatsapp.net';
        }
        
        // Ensure @s.whatsapp.net suffix
        if (!normalizedSender.endsWith('@s.whatsapp.net')) {
            const number = normalizedSender.replace(/\D/g, '');
            normalizedSender = `${number}@s.whatsapp.net`;
        }
        
        return normalizedSender === this.bot.ownerId;
    }
    
    return false;
}
```

**Perubahan Kunci:**
- Tambahan direct matching sebagai pengecekan pertama (mendukung `@lid`)
- Jika owner menggunakan `@s.whatsapp.net`, sender `@lid` tidak bisa match (sistem WhatsApp)
- Jika owner menggunakan `@lid`, hanya sender dengan `@lid` yang sama bisa match

### 2. Dokumentasi Format di .env.example

**Sebelum:**
```env
# FORMAT WAJIB: nomor@s.whatsapp.net
# REQUIRED FORMAT: number@s.whatsapp.net
# Contoh/Example: 6281234567890@s.whatsapp.net
BOT_OWNER_ID=
```

**Sesudah:**
```env
# FORMAT: nomor@s.whatsapp.net ATAU linkedid@lid
# FORMAT: number@s.whatsapp.net OR linkedid@lid
# Contoh/Example: 
#   6281234567890@s.whatsapp.net (format nomor)
#   12345678901234@lid (format Linked ID)
# Cek log bot untuk melihat sender ID asli Anda
# Check bot logs to see your actual sender ID
BOT_OWNER_ID=
```

**Catatan Penting:**
- User harus memeriksa log bot untuk melihat format sender ID mereka
- Jika sender menggunakan `@lid`, set owner ID dengan format `@lid`
- Jika sender menggunakan `@s.whatsapp.net`, set owner ID dengan format `@s.whatsapp.net`

### 3. Cara Menggunakan

**Opsi 1: Format Nomor Telepon (Traditional)**
```env
BOT_OWNER_ID=6281234567890@s.whatsapp.net
```

**Opsi 2: Format Linked ID (Privacy Mode)**
```env
BOT_OWNER_ID=12345678901234@lid
```

**Cara Menemukan Owner ID Anda:**
1. Kirim perintah seperti `.security status` ke bot
2. Lihat log bot untuk melihat sender ID Anda:
   ```
   "sender":"12345678901234@lid"
   ```
3. Copy dan paste ID tersebut ke `.env`:
   ```env
   BOT_OWNER_ID=12345678901234@lid
   ```

---

## 📁 File yang Dimodifikasi (v2.4.1)

| File | Tipe | Perubahan |
|------|------|-----------|
| `config.js` | Modified | Updated `_normalizeOwnerId()` to accept `@lid` format |
| `config.js` | Modified | Updated `isOwner()` with direct matching for both formats |
| `.env.example` | Modified | Documented `@lid` format support with examples |
| `UPDATE-REPORT.md` | Modified | Documented v2.4.1 changes |

---

## ⚠️ Saran untuk Sesi AI Berikutnya (v2.4.1)

### Hal yang Harus Diingat:

1. **Format Owner ID yang Valid:**
   ```
   ✅ BOT_OWNER_ID=6281234567890@s.whatsapp.net (traditional)
   ✅ BOT_OWNER_ID=12345678901234@lid (privacy mode)
   ❌ BOT_OWNER_ID=6281234567890 (harus ada suffix)
   ```

2. **Matching Behavior:**
   - `@lid` owner hanya match dengan `@lid` sender yang sama
   - `@s.whatsapp.net` owner bisa match dengan berbagai format sender (kecuali `@lid`)
   - Direct match selalu diutamakan sebelum normalisasi

3. **User Instructions:**
   - Selalu sarankan user untuk memeriksa log bot untuk melihat format sender ID mereka
   - Log menampilkan sender ID lengkap: `"sender":"xxxxx@lid"` atau `"sender":"xxxxx@s.whatsapp.net"`

4. **Testing Commands:**
   ```
   .security status  # Test owner-only command
   .spam 081234567890 1 test  # Test another owner-only command
   ```

### Hal yang Harus Dihindari:

1. **Jangan asumsikan format** - User bisa menggunakan format apapun, biarkan mereka memeriksa log
2. **Jangan konversi antara @lid dan @s.whatsapp.net** - Ini adalah sistem ID yang berbeda dan tidak bisa dikonversi
3. **Jangan hapus normalisasi nomor telepon** - Format nomor telepon tanpa suffix masih harus didukung untuk backward compatibility

---

## 📋 Ringkasan Perubahan (v2.4.0)

Update ini menambahkan:
1. **Perbaikan Bug Owner ID** - Memastikan `BOT_OWNER_ID` menggunakan format `number@s.whatsapp.net` secara konsisten
2. **Terjemahan Bahasa Indonesia** - Semua output perintah diterjemahkan ke Bahasa Indonesia
3. **Optimisasi Penggunaan Memori** - Cache dan rate limiter yang lebih ringan dengan eviction dan batas
4. **Konfigurasi .env Komprehensif** - File `.env.example` yang diperluas dengan semua opsi konfigurasi
5. **Perintah Restart Langsung** - `.security restart` tanpa memerlukan kode konfirmasi
6. **Perintah Owner-Only yang Dapat Dikonfigurasi** - Daftar perintah khusus owner dapat diatur melalui `.env`

---

## 🔄 Perubahan Detail (v2.4.0)

### 1. Perbaikan Bug Owner ID

**Masalah:**
Nilai `BOT_OWNER_ID` tidak diterapkan dengan benar pada perintah khusus owner seperti `.security` dan `.spam`. Sistem menggunakan format yang tidak konsisten (`@lid` vs `@s.whatsapp.net`).

**Solusi:**
- Menambahkan fungsi `_normalizeOwnerId()` di `config.js` untuk normalisasi format ID owner
- Menambahkan method `isOwner()` terpusat di `config.js` untuk pengecekan owner yang konsisten
- Menambahkan method `isOwnerOnlyCommand()` untuk pengecekan perintah khusus owner
- Memperbarui `commands/security.js` untuk menggunakan `config.isOwner(sender)` 
- Memperbarui `commands/spam.js` untuk menggunakan `config.isOwner(sender)`
- Memperbarui `utils/security.js` untuk menggunakan pengecekan terpusat dari config

**Perubahan Kode:**

```javascript
// config.js - Method baru
_normalizeOwnerId(ownerId) {
    if (!ownerId) return null;
    let normalized = ownerId.trim();
    
    // Jika sudah format benar
    if (normalized.endsWith('@s.whatsapp.net')) {
        const number = normalized.replace('@s.whatsapp.net', '').replace(/\D/g, '');
        return number ? `${number}@s.whatsapp.net` : null;
    }
    
    // Peringatan untuk format @lid
    if (normalized.endsWith('@lid')) {
        console.warn('⚠️ WARNING: BOT_OWNER_ID uses @lid format which is not supported.');
        return null;
    }
    
    // Normalisasi nomor telepon
    const number = normalized.replace(/\D/g, '');
    return number ? `${number}@s.whatsapp.net` : null;
}

isOwner(senderId) {
    if (!this.bot.ownerId || !senderId) return false;
    // ... logika normalisasi dan perbandingan
    return normalizedSender === this.bot.ownerId;
}
```

**File yang Dimodifikasi:**
- `config.js` - Menambahkan normalisasi owner ID dan method isOwner()
- `commands/security.js` - Menggunakan config.isOwner() untuk validasi
- `commands/spam.js` - Menggunakan config.isOwner() untuk validasi
- `utils/security.js` - Menggunakan config untuk pengecekan izin

### 2. Log Sender ID Lengkap

**Perubahan:**
Logger sekarang menampilkan sender ID lengkap (`number@s.whatsapp.net`) untuk identifikasi yang presisi.

```javascript
// utils/logger.js
formatCommand(command, sender, from, isGroup) {
    return {
        command,
        sender: sender, // ID JID lengkap untuk identifikasi presisi
        senderNumber: sender.split('@')[0], // Hanya nomor untuk keterbacaan
        chat: isGroup ? 'grup' : 'pribadi',
        chatId: from
    };
}
```

### 3. Terjemahan Bahasa Indonesia

**Semua output perintah diterjemahkan ke Bahasa Indonesia:**

| Perintah | Perubahan |
|----------|-----------|
| `.security` | Semua pesan dan menu dalam Bahasa Indonesia |
| `.spam` | Semua pesan dalam Bahasa Indonesia |
| `.fact` | Fakta cadangan dalam Bahasa Indonesia |
| `.quote` | Kutipan cadangan dalam Bahasa Indonesia |
| `.joke` | Lelucon cadangan dalam Bahasa Indonesia |
| `.info` | Informasi grup dalam Bahasa Indonesia |
| `.ping` | Status sistem dalam Bahasa Indonesia |

**Contoh Sebelum:**
```
🔒 This command is owner-only.
```

**Contoh Sesudah:**
```
🔒 *Akses Ditolak*

Perintah ini hanya untuk owner bot.
Pengirim: 6281234567890@s.whatsapp.net
```

### 4. Optimisasi Penggunaan Memori

**Perbaikan pada `utils/cache.js`:**
- Menambahkan batas maksimal entri (`maxEntries: 1000`)
- Implementasi eviction otomatis (`_evictOldest()`) saat cache penuh
- Interval cleanup yang dapat dikonfigurasi via env

**Perbaikan pada `utils/rate-limiter.js`:**
- Menambahkan batas maksimal pengguna yang dilacak (`maxTrackedUsers: 5000`)
- Implementasi eviction pengguna tidak aktif
- Interval cleanup yang lebih efisien (2 menit default)

```javascript
// Cache dengan batas dan eviction
set(key, value, ttl = 300000) {
    if (this.store.size >= this.maxEntries) {
        this._evictOldest(); // Hapus 10% entri terlama
    }
    // ...
}
```

### 5. Konfigurasi .env Komprehensif

**Opsi baru di `.env.example`:**

```env
# Perintah khusus owner (dipisahkan koma)
OWNER_ONLY_COMMANDS=security,spam

# Interval cleanup cache (milidetik)
CACHE_CLEANUP_INTERVAL=300000

# Interval cleanup rate limiter (milidetik)
RATE_LIMITER_CLEANUP_INTERVAL=60000

# Durasi blokir otomatis (milidetik)
AUTO_BLOCK_DURATION=1800000

# Batas aktivitas mencurigakan sebelum blokir
SUSPICIOUS_ACTIVITY_THRESHOLD=20
```

### 6. Perintah .security Restart Langsung

**Sebelum:** Memerlukan kode konfirmasi untuk restart/stop
**Sesudah:** Langsung eksekusi tanpa konfirmasi

**Subperintah baru:**
- `.security restart` - Restart PM2 process langsung
- `.security stop` - Hentikan PM2 process langsung

```javascript
async handleRestart(sock, from, msg) {
    const pm2ProcessName = process.env.PM2_PROCESS_NAME || 'hambot';
    
    await this.reply(sock, from, msg, 
        '🔄 *Me-restart proses bot...*\n\n' +
        `Proses PM2: ${pm2ProcessName}\n` +
        'Bot akan kembali dalam beberapa detik.');

    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
        const pm2Restart = spawn('pm2', ['restart', pm2ProcessName], {
            detached: true,
            stdio: 'ignore'
        });
        pm2Restart.unref();
    } catch (error) {
        process.exit(0); // Fallback ke exit
    }
}
```

### 7. Perintah Owner-Only yang Dapat Dikonfigurasi

**Cara Mengkonfigurasi:**
```env
# Di .env
OWNER_ONLY_COMMANDS=security,spam,restart,admin
```

**Cara Kerja:**
- Daftar perintah diparsing dari env saat startup
- Jika perintah ada di daftar, hanya owner yang bisa menggunakan
- Jika dihapus dari daftar, perintah dapat diakses semua orang

---

## 📁 File yang Dimodifikasi (v2.4.0)

| File | Tipe | Perubahan |
|------|------|-----------|
| `config.js` | Modified | Normalisasi owner ID, method isOwner(), isOwnerOnlyCommand() |
| `commands/security.js` | Modified | Restart langsung, terjemahan Indonesia, owner check terpusat |
| `commands/spam.js` | Modified | Owner check terpusat, terjemahan Indonesia |
| `commands/fact.js` | Modified | Terjemahan fakta cadangan ke Indonesia |
| `commands/quote.js` | Modified | Terjemahan kutipan ke Indonesia |
| `commands/joke.js` | Modified | Terjemahan lelucon ke Indonesia |
| `commands/info.js` | Modified | Terjemahan output ke Indonesia |
| `utils/security.js` | Modified | Menggunakan config.isOwnerOnlyCommand() |
| `utils/logger.js` | Modified | Menampilkan sender ID lengkap |
| `utils/cache.js` | Modified | Batas entri, eviction, optimisasi memori |
| `utils/rate-limiter.js` | Modified | Batas pengguna, eviction, optimisasi memori |
| `.env.example` | Modified | Opsi konfigurasi komprehensif dengan dokumentasi bilingual |
| `UPDATE-REPORT.md` | Modified | Dokumentasi perubahan v2.4.0 |

---

## ⚠️ Saran untuk Sesi AI Berikutnya (v2.4.0)

### Hal yang Harus Dihindari:

1. **Jangan gunakan format `@lid` untuk BOT_OWNER_ID** - Format ini adalah ID internal WhatsApp dan tidak bisa dibandingkan dengan JID standar. Selalu gunakan `number@s.whatsapp.net`.

2. **Jangan lakukan pengecekan owner manual** - Selalu gunakan `config.isOwner(sender)` yang sudah terpusat.

3. **Jangan tambahkan perintah owner-only langsung di kode** - Gunakan konfigurasi `OWNER_ONLY_COMMANDS` di `.env`.

4. **Jangan abaikan batas memori** - Cache dan rate limiter sekarang memiliki batas. Pastikan tidak mengubah batas tanpa pertimbangan.

5. **Jangan hapus terjemahan Indonesia** - Semua output harus konsisten dalam Bahasa Indonesia.

### Hal yang Harus Diingat:

1. **Format Owner ID yang Benar:**
   ```
   BOT_OWNER_ID=6281234567890@s.whatsapp.net
   ```
   Bukan:
   ```
   BOT_OWNER_ID=8888@lid
   BOT_OWNER_ID=6281234567890
   ```

2. **Pengecekan Owner Terpusat:**
   ```javascript
   // BENAR
   if (!config.isOwner(sender)) {
       return await this.reply(...);
   }
   
   // SALAH
   if (sender !== process.env.BOT_OWNER_ID) {
       return await this.reply(...);
   }
   ```

3. **Perintah Owner-Only via .env:**
   ```env
   OWNER_ONLY_COMMANDS=security,spam,admin
   ```

4. **Optimisasi Memori:**
   - Cache maksimal 1000 entri
   - Rate limiter maksimal 5000 pengguna
   - Eviction otomatis saat batas tercapai

5. **Log dengan Sender ID Lengkap:**
   - Log sekarang menampilkan JID lengkap
   - Memudahkan identifikasi pengguna

### Testing Rekomendasi:

```
# Test owner check dengan format berbeda
# Set BOT_OWNER_ID ke nomor Anda
.security status  # Harus berhasil sebagai owner
.spam 081234567890 1 test  # Harus berhasil sebagai owner

# Test restart langsung
.security restart  # Tidak perlu kode

# Test dengan non-owner
# Login dengan nomor berbeda
.security status  # Harus ditolak dengan pesan Indonesia

# Test konfigurasi owner-only commands
# Tambahkan perintah ke OWNER_ONLY_COMMANDS
# Coba akses dengan non-owner
```

### Peningkatan untuk Pertimbangan Masa Depan:

1. **Multi-Owner Support** - Mendukung beberapa owner dalam daftar
2. **Role-Based Access Control** - Sistem peran (owner, admin, user)
3. **Per-Group Owner** - Owner yang berbeda per grup
4. **Audit Log** - Log semua aksi admin

---

## 📋 Ringkasan Perubahan (v2.3.0)

Update ini menambahkan:

| Command | Description |
|---------|-------------|
| `.brat <text>` | Creates a static WebP sticker with bold text |
| `.bratvid <text>` | Creates an animated WebP sticker with jitter effect |

**Technical Implementation:**

1. **Static Sticker (`.brat`)**
   - Uses `canvas` library to generate 512x512 PNG image
   - Implements automatic text wrapping for long texts
   - Dynamically calculates optimal font size to fit content
   - Converts to WebP using `sharp` library

2. **Animated Sticker (`.bratvid`)**
   - Generates 6 frames with jitter/offset effect
   - Uses `ffmpeg` to create animated WebP at 10fps
   - Infinite loop for continuous animation
   - Automatic cleanup of temporary frame files

**Code Structure:**
```javascript
class BratCommand extends CommandBase {
    constructor() {
        super({
            name: 'brat',
            aliases: ['bratvid'],
            category: 'tools',
            isHeavy: true,
            cooldown: 3000
        });
    }

    // Key methods:
    // - createStaticSticker() - Generate static WebP sticker
    // - createAnimatedSticker() - Generate animated WebP with jitter
    // - createBratCanvas() - Core canvas rendering with text
    // - wrapText() - Handle long text wrapping
    // - calculateOptimalFontSize() - Fit text to canvas
    // - createAnimatedWebP() - Use ffmpeg for animation
}
```

**Canvas Settings:**
- Canvas Size: 512x512 pixels
- Background Color: #FFFFFF (pure white)
- Text Color: #000000 (pure black)
- Padding: 30 pixels
- Line Spacing: 1.1x font size
- Max Text Length: 200 characters
- Animation Framerate: 10 fps

**Jitter Effect Pattern (for animation):**
```javascript
// Defined as class property for easy modification
this.jitterPatterns = [
    { x: 0, y: 0 },
    { x: 3, y: -2 },
    { x: -3, y: 3 },
    { x: 2, y: -3 },
    { x: -2, y: 2 },
    { x: 3, y: 3 }
];
// frameCount is derived from jitterPatterns.length
```

### 2. New Dependency: `canvas` Package

**Purpose:** Server-side canvas rendering for image generation.

**Installation:**
```bash
npm install canvas@3.2.1
```

**Package.json Update:**
```json
{
    "dependencies": {
        "canvas": "^3.2.1"
    }
}
```

**Note:** The `canvas` package requires native dependencies (Cairo, Pango, etc.) which are typically pre-installed on most Linux servers. If not available, install with:
```bash
# Ubuntu/Debian
sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

### 3. FFmpeg Integration

**Purpose:** Create animated WebP stickers from multiple PNG frames.

**FFmpeg Command Used:**
```bash
ffmpeg -y -framerate 10 -i frame_%03d.png \
    -vf 'scale=512:512:flags=lanczos' \
    -loop 0 \
    -c:v libwebp \
    -lossless 0 \
    -compression_level 4 \
    -q:v 80 \
    -preset default \
    output.webp
```

**Parameters Explained:**
- `-framerate 10`: 10 frames per second (smooth animation)
- `-loop 0`: Infinite loop
- `-c:v libwebp`: WebP video codec
- `-lossless 0`: Lossy compression for smaller file size
- `-q:v 80`: Quality level (0-100)

---

## 📁 Files Modified (v2.3.0)

| File | Type | Changes |
|------|------|---------|
| `commands/brat.js` | **NEW** | Brat-style sticker command with static and animated support |
| `package.json` | Modified | Added `canvas@3.2.1` dependency |
| `UPDATE-REPORT.md` | Modified | Added v2.3.0 documentation |

---

## ⚠️ Suggestions for Future AI Sessions (v2.3.0)

### Things to Avoid:

1. **Don't forget to install native dependencies for Canvas** - The `canvas` package requires Cairo, Pango, and other native libraries. If you get compilation errors, install the prerequisites first.

2. **Don't spawn FFmpeg directly without error handling** - Always wrap FFmpeg calls in try-catch and provide user-friendly error messages.

3. **Don't forget to cleanup temporary files** - When generating multiple frames for animation, always use `cleanupFiles()` in a `finally` block.

4. **Don't use very long text without validation** - The command limits text to 200 characters to ensure readable output.

5. **Don't forget the file pattern format** - FFmpeg requires frame files to follow a pattern like `frame_%03d.png` (zero-padded numbers).

### Things to Keep in Mind:

1. **Canvas font availability** - The code uses fallback fonts (`Arial Black`, `Impact`, `Helvetica Neue`, `Arial`). Not all fonts may be available on all systems.

2. **FFmpeg WebP support** - Ensure FFmpeg is compiled with `--enable-libwebp` for animated WebP output.

3. **Jitter effect is subtle** - The animation uses small pixel offsets (2-3px) for a chaotic effect without being too jarring.

4. **Heavy command flag** - The `isHeavy: true` flag ensures proper queue management for resource-intensive operations.

5. **Dynamic font sizing** - The code automatically reduces font size from 120px to fit text within the canvas, with a minimum of 24px.

6. **Text wrapping algorithm** - Uses word-by-word measurement to wrap text to multiple lines. Single long words are not split.

### Testing the Command:

```
# Static sticker tests
.brat hello world
.brat This is a longer text that will wrap to multiple lines
.brat BRAT

# Animated sticker tests
.bratvid BRAT
.bratvid hello world

# Edge cases
.brat   (no text - shows usage)
.brat <very long text over 200 chars>  (should show error)
```

### Future Improvements to Consider:

1. **Custom colors** - Allow users to specify background/text colors via arguments
2. **Font selection** - Let users choose from available system fonts
3. **Animation speed** - Allow customizing the framerate (5-15 fps)
4. **Shake intensity** - Let users control the jitter amount
5. **Gradient backgrounds** - Support gradient backgrounds instead of solid white
6. **Text effects** - Add options like shadow, outline, or glow effects

---

## 📋 Summary of Changes (v2.2.0)

This update focuses on:
1. **Mobile-friendly formatting** - Removed all ASCII art and box-drawing characters from command outputs
2. **New spam command** - Owner-only spam command with safety mechanisms
3. **Universal emoji support** - Replaced fancy Unicode with simple, widely-supported emojis

---

## 🔄 Detailed Changes (v2.2.0)

### 1. Removed ASCII Art and Box-Drawing Characters

**Problem:** ASCII art and box-drawing characters (─, │, ┌, ┐, └, ┘, ═, ║, ╔, ╚, ╭, ╰, ━, ▸, etc.) don't render properly on all devices, especially mobile phones and some WhatsApp clients.

**Solution:** Replaced all decorative borders with clean, minimal formatting using:
- `*bold*` for headers
- Bullet points (`•` or `-`) for lists
- Simple emojis (1-2 per section max)
- Short lines (max 35-40 characters)

**Files Updated:**

| File | Changes |
|------|---------|
| `commands/dns.js` | Removed box borders, simplified output |
| `commands/ipinfo.js` | Removed box borders, cleaner layout |
| `commands/netinfo.js` | Complete rewrite of all 10 topic outputs |
| `commands/port.js` | Removed tables, simplified lists |
| `commands/subnet.js` | Removed box borders, cleaner output |

**Before (Example - DNS):**
```
╔══════════════════════════════╗
║  🔍 *HASIL DNS LOOKUP*  ║
╚══════════════════════════════╝

┌──────────────────────────────┐
│ 📍 *A Record (IPv4):*
├──────────────────────────────
│ ▸ 142.250.190.78
└──────────────────────────────┘
```

**After (Example - DNS):**
```
🔍 *HASIL DNS LOOKUP*

📥 *Domain:* google.com

📍 *A Record (IPv4)*
• 142.250.190.78
```

### 2. New Spam Command (`commands/spam.js`)

**Purpose:** Owner-only prank spam command with comprehensive safety features.

**Features:**
- **Owner Only:** Restricted to bot owner (set via `OWNER_NUMBER` env variable)
- **Max Limit:** Hardcoded maximum of 50 messages per command
- **Random Delay:** 1.5-3 seconds between messages (mimics human behavior)
- **Stop on Error:** Immediately stops if any message fails
- **Phone Number Parsing:** Supports multiple formats:
  - @mention
  - Local format: 081234567890
  - International: 6281234567890
  - With country code: +6281234567890

**Usage:**
```
.spam <target> <amount> <message>

Examples:
.spam @mention 10 Hello!
.spam 081234567890 5 Test message
.spam 6281234567890 20 Hi there
```

**Safety Mechanisms:**
1. **Owner Check:** Only works for owner (OWNER_NUMBER env var)
2. **Max Limit:** If user requests 100 messages, limited to 50
3. **Random Delay:** `randomDelay(1500, 3000)` ms between sends
4. **Error Stop:** Loop breaks on first failure
5. **Feedback:** Shows progress and completion status

**Code Structure:**
```javascript
class SpamCommand extends CommandBase {
    constructor() {
        super({
            name: 'spam',
            category: 'fun',
            isHeavy: true,
            cooldown: 10000
        });
        this.MAX_LIMIT = 50;
    }

    randomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    parseTarget(input) {
        // Convert phone number to JID
    }

    isOwner(sender) {
        // Check if sender is owner
    }

    async execute(sock, msg, args, context) {
        // Main logic with safety checks
    }
}
```

---

## 📁 Files Modified (v2.2.0)

| File | Type | Changes |
|------|------|---------|
| `commands/dns.js` | Modified | Removed ASCII art, simplified output |
| `commands/ipinfo.js` | Modified | Removed ASCII art, cleaner layout |
| `commands/netinfo.js` | Modified | Complete rewrite of all outputs |
| `commands/port.js` | Modified | Removed tables, simplified lists |
| `commands/subnet.js` | Modified | Removed ASCII art, cleaner output |
| `commands/spam.js` | **NEW** | Owner-only spam with safety features |
| `UPDATE-REPORT.md` | Modified | Added v2.2.0 documentation |

---

## ⚠️ Suggestions for Future AI Sessions

### Things to Avoid:

1. **Don't use ASCII art or box-drawing characters** - They don't render properly on mobile devices. Avoid these characters:
   - Box drawing: `─`, `│`, `┌`, `┐`, `└`, `┘`, `═`, `║`, `╔`, `╗`, `╚`, `╝`, `╭`, `╰`, `━`
   - Fancy symbols: `▸`, `▶`, `►`, `◆`, `◇`, `◈`

2. **Don't use static delays in spam/bulk operations** - Use `randomDelay(min, max)` to mimic human behavior and avoid bans.

3. **Don't create spam commands without owner check** - Always restrict dangerous commands to owner only.

4. **Don't forget to add env variable documentation** - The spam command requires `OWNER_NUMBER` to be set.

5. **Don't use `eleven_v3` model** - It's not available for free tier ElevenLabs accounts. Use `eleven_multilingual_v2` instead.

6. **Don't hardcode platform-specific logic in commands** - Use the centralized `url-parser.js` utility for all URL handling.

### Things to Keep in Mind:

1. **Mobile-first formatting** - WhatsApp is primarily mobile. Keep lines short (max 35-40 chars) and avoid complex layouts.

2. **Simple emojis only** - Use basic emojis like 📍, 🔍, ✅, ❌. Avoid emoji combinations or rare Unicode symbols.

3. **Spam command safety** - The spam command has multiple safety layers:
   - Owner-only access
   - Max 50 messages limit
   - Random 1.5-3s delay
   - Stop on first error

4. **Owner number format** - Set `OWNER_NUMBER=6281234567890` (without + or spaces) in `.env`.

5. **Command output guidelines:**
   - Use `*bold*` for headers
   - Use `•` for bullet points
   - Max 1-2 emojis per section
   - No decorative borders
   - Keep lines short

6. **URL Parser is extensible** - Add new platforms to `PLATFORMS` object in `url-parser.js`.

7. **Platform-specific arguments matter** - Some platforms need special handling:
   - YouTube: `--extractor-args youtube:player_client=android`
   - TikTok: `--extractor-args tiktok:api_hostname=...`

### Environment Variables to Document:

```env
# Spam command (new in v2.2.0)
OWNER_NUMBER=6281234567890  # Bot owner's phone number (without +)
```

### Future Improvements to Consider:

1. **Spam target validation** - Check if target number exists on WhatsApp before spamming.

2. **Spam scheduling** - Allow scheduling spam at specific times.

3. **Spam templates** - Pre-defined message templates for common pranks.

4. **Rate limiting per user** - Implement per-user rate limits for spam command.

5. **Admin roles** - Allow multiple admins, not just owner.

6. **Output format settings** - Allow users to choose between compact/detailed output.

---

## 🧪 Testing Recommendations

### ASCII Art Removal Tests:
```
# Test each command to verify clean output
.dns google.com
.ipinfo 8.8.8.8
.subnet 192.168.1.0/24
.port 22
.port ssh
.netinfo osi
.netinfo tcpip
.netinfo subnetting
```

### Spam Command Tests:
```
# Test without owner (should fail)
.spam 081234567890 5 Test

# Test with owner (set OWNER_NUMBER first)
.spam 081234567890 3 Hello!

# Test limit enforcement
.spam 081234567890 100 Test  # Should limit to 50

# Test invalid inputs
.spam invalid 5 Test
.spam 081234567890 abc Test
.spam 081234567890 5
```

---

## 📋 Previous Changes (v2.1.0)

### 1. New URL Parser Utility (`utils/url-parser.js`)

**Purpose:** Comprehensive URL recognition and normalization for 30+ social media platforms.

**Features:**
- Supports main URLs, short URLs, mobile URLs, and various URL formats
- Platform detection with type classification (video/audio/both)
- Platform-specific yt-dlp argument generation
- Human-readable platform name extraction

### 2. Updated Video Command (`commands/video.js`)

- Integrated URL parser for comprehensive platform detection
- Added platform-specific yt-dlp arguments for better compatibility
- Enhanced help message showing supported platforms

### 3. Updated Music Command (`commands/music.js`)

- Integrated URL parser for multi-platform audio extraction
- Platform-specific handling for audio sources

### 4. Enhanced Menu Command (`commands/menu.js`)

- **Command-specific help:** `.menu <command>` now shows detailed help
- **Comprehensive usage guides** for each command

### 5. Fixed ElevenLabs TTS (`commands/say.js`)

- Changed model from `eleven_v3` to `eleven_multilingual_v2`
- Removed expression tags support
- Simplified voice settings for free tier compatibility

---

## 📞 Contact

For issues or questions about these changes, refer to:
- Repository: `AkilixCode/hambot-wa-bot`
- Custom Instructions: `README-FOR-AI.md`

---

*This report was automatically generated by GitHub Copilot AI.*
