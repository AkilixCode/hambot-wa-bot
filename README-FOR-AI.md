## Music Downloader Strategy
To bypass YouTube restrictions, we use a specific strategy:
1. **Runner**: `python3 -m yt_dlp` (to utilize installed plugins like `yt-dlp-get-pot`).
2. **Client**: `android` or `android_creator` extractor args.
3. **Proxy**: Must use SOCKS5 proxy defined in ENV.
4. **Process**: Do not filter formats (`-f`). Let it download best available, then auto-convert (`-x --audio-format mp3`).
