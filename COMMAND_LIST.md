# COMMAND_LIST.md

## Complete Command Reference

### 📊 Command Statistics
- **Total Commands:** 26
- **Categories:** 7
- **System Commands:** 2
- **Utility Commands:** 6
- **Media Commands:** 3
- **Fun/Game Commands:** 10
- **Information Commands:** 3
- **Group Commands:** 2

---

## 🎯 Commands by Category

### ⚙️ System (2)

#### `.ping` - System Status
Check bot response time and system information
- **Aliases:** `p`, `status`
- **Usage:** `.ping`
- **Features:** Shows CPU, RAM, uptime, cache stats

#### `.menu` - Help Menu
Display all available commands
- **Aliases:** `help`, `intro`, `commands`
- **Usage:** `.menu [category]`
- **Features:** Categorized command listing

---

### 🛠️ Utility Commands (6)

#### `.calc` - Calculator
Evaluate mathematical expressions
- **Aliases:** `calculate`, `math`
- **Usage:** `.calc <expression>`
- **Examples:**
  - `.calc 5 + 3`
  - `.calc sqrt(16)`
  - `.calc 2^8`
- **Supports:** +, -, *, /, ^, sqrt, sin, cos, tan, log, abs, round, floor, ceil, pi

#### `.weather` - Weather Info
Get current weather for any location
- **Aliases:** `cuaca`, `wthr`
- **Usage:** `.weather <city>`
- **Examples:**
  - `.weather London`
  - `.weather Jakarta`
- **Features:** Temperature, humidity, wind speed, UV index, cached results

#### `.qr` - QR Code Generator
Generate QR codes from text or URLs
- **Aliases:** `qrcode`, `qrgen`
- **Usage:** `.qr <text or URL>`
- **Examples:**
  - `.qr https://google.com`
  - `.qr +1234567890`

#### `.translate` - Translator
Translate text between languages
- **Aliases:** `tr`, `trans`
- **Usage:** `.translate <lang> <text>`
- **Examples:**
  - `.translate id Hello World`
  - `.translate es Good morning`
- **Supported:** en, id, es, fr, de, ja, ko, zh, ar, hi, and more

#### `.time` - World Clock
Get current time in different timezones
- **Aliases:** `timezone`, `clock`
- **Usage:** `.time [city]`
- **Examples:**
  - `.time` (shows multiple timezones)
  - `.time tokyo`
  - `.time newyork`
- **Supports:** 30+ major cities worldwide

#### `.sticker` - Sticker Maker
Convert images to WhatsApp stickers
- **Aliases:** `s`, `stiker`, `stik`
- **Usage:** `.sticker` (send with image or reply to image)
- **Features:** Auto-resize to 512x512, maintains transparency

---

### 🎵 Media Commands (3)

#### `.music` - Music Download
Search and download songs from YouTube
- **Aliases:** `song`, `mp3`, `audio`
- **Usage:** `.music <song name>`
- **Example:** `.music About You The 1975`
- **Features:** Duration check, cached searches, MP3 format

#### `.pinterest` - Image Search
Search aesthetic images from Pinterest
- **Aliases:** `pin`, `pint`
- **Usage:** `.pinterest <search query>`
- **Example:** `.pinterest Cyberpunk City`
- **Features:** Returns 3 random images, cached results

#### `.movie` - Movie Information
Get movie details from OMDb
- **Aliases:** `film`, `imdb`
- **Usage:** `.movie <movie title>`
- **Example:** `.movie Interstellar`
- **Features:** Rating, synopsis (translated), poster, cached results

---

### 🎮 Fun & Games (10)

#### `.dice` - Dice Roll
Roll dice with various configurations
- **Aliases:** `roll`, `d`
- **Usage:** `.dice [notation]`
- **Examples:**
  - `.dice` (rolls 1d6)
  - `.dice 2d20` (rolls 2 dice with 20 sides)
  - `.dice 3d6` (rolls 3 dice with 6 sides)
- **Features:** Shows individual rolls, total, average

#### `.flip` - Coin Flip
Flip a coin (heads or tails)
- **Aliases:** `coin`, `coinflip`
- **Usage:** `.flip`

#### `.8ball` - Magic 8-Ball
Ask the magic 8-ball a yes/no question
- **Aliases:** `8b`, `ask`
- **Usage:** `.8ball <question>`
- **Example:** `.8ball Will I be rich?`
- **Features:** 20 different responses

#### `.rps` - Rock Paper Scissors
Play rock paper scissors with the bot
- **Aliases:** `rockpaperscissors`
- **Usage:** `.rps <rock/paper/scissors>`
- **Example:** `.rps rock`

#### `.quote` - Inspirational Quotes
Get random inspirational quotes
- **Aliases:** `quotes`, `inspire`
- **Usage:** `.quote`
- **Features:** API-powered with fallback quotes

#### `.joke` - Random Jokes
Get random jokes
- **Aliases:** `jokes`, `funny`
- **Usage:** `.joke`
- **Features:** API-powered, safe mode enabled

#### `.fact` - Random Facts
Get interesting random facts
- **Aliases:** `randomfact`, `funfact`
- **Usage:** `.fact`
- **Features:** Educational and entertaining facts

#### `.trivia` - Trivia Quiz
Play trivia quiz game
- **Aliases:** `quiz`, `question`
- **Usage:** `.trivia [difficulty]`
- **Examples:**
  - `.trivia` (medium difficulty)
  - `.trivia easy`
  - `.trivia hard`
- **Features:** Multiple choice, reveals answer after 5 seconds

#### `.meme` - Random Memes
Get random memes from Reddit
- **Aliases:** `memes`
- **Usage:** `.meme`
- **Features:** Fresh memes from various subreddits

#### `.toimg` - Sticker to Image
Convert stickers back to images
- **Aliases:** `toimage`, `stickertoimg`
- **Usage:** `.toimg` (reply to a sticker)

---

### ℹ️ Information Commands (3)

#### `.wiki` - Wikipedia Search
Search Wikipedia and get article summaries
- **Aliases:** `wikipedia`
- **Usage:** `.wiki <search term>`
- **Examples:**
  - `.wiki Albert Einstein`
  - `.wiki Python programming`
- **Features:** Summary, thumbnail, link, cached results

#### `.crypto` - Cryptocurrency Prices
Get real-time cryptocurrency information
- **Aliases:** `coin`, `bitcoin`, `btc`
- **Usage:** `.crypto [symbol]`
- **Examples:**
  - `.crypto bitcoin`
  - `.crypto ethereum`
  - `.crypto dogecoin`
- **Features:** Price, 24h change, market cap, volume, cached for 5 minutes

#### `.gempa` - Earthquake Info
Get latest earthquake data (Indonesia - BMKG)
- **Aliases:** `earthquake`, `quake`
- **Usage:** `.gempa`
- **Features:** Magnitude, location, depth, shakemap, cached results

---

### 👥 Group Commands (2)

#### `.info` - Group Information
Display group metadata and statistics
- **Aliases:** `groupinfo`, `grup`
- **Usage:** `.info`
- **Features:** Member count, admin count, creation date, description
- **Note:** Group only

#### `.tagall` - Tag All Members
Mention all group members
- **Aliases:** `everyone`, `all`, `hidetag`
- **Usage:** `.tagall [message]`
- **Example:** `.tagall Meeting in 5 minutes!`
- **Features:** Custom message, lists all members
- **Note:** Group only

---

## 📈 Command Features

### Caching
Commands with caching for better performance:
- `.weather` (10 minutes)
- `.pinterest` (10 minutes)
- `.movie` (1 hour)
- `.wiki` (1 hour)
- `.crypto` (5 minutes)
- `.gempa` (5 minutes)

### Rate Limiting
All commands are rate-limited:
- Default: 10 commands per minute per user
- Configurable in `.env`

### Error Handling
All commands include:
- Comprehensive error messages
- Graceful fallbacks
- Automatic retries
- User-friendly feedback

---

## 🎯 Command Usage Tips

### Aliases
Most commands have multiple aliases. For example:
- `.ping` = `.p` = `.status`
- `.music` = `.song` = `.mp3`
- `.sticker` = `.s` = `.stik`

### Arguments
- `<required>` - Must provide this argument
- `[optional]` - Can omit this argument
- `<choice1/choice2>` - Choose one option

### Examples
Each command includes helpful examples. Try:
- `.calc` without arguments to see calculator help
- `.weather` without a city to see usage
- `.time` without a city to see world clock

---

## 🚀 Coming Soon

Future commands planned:
- `.video` - Video downloader (migrating from legacy)
- `.say` - Text-to-speech (migrating from legacy)
- `.anime` - Anime information (migrating from legacy)
- `.news` - Latest news headlines
- `.define` - Dictionary definitions
- `.urban` - Urban dictionary
- `.cat` / `.dog` - Random pet pictures
- `.math` - Advanced math solver

---

## 💡 Pro Tips

1. **Use caching**: Repeated queries are much faster!
2. **Try aliases**: Shorter commands save typing
3. **Check help**: Use `.menu` to explore all commands
4. **Report issues**: If a command fails, try again or contact support

---

*Last updated: January 27, 2026*
*Total Commands: 26*
