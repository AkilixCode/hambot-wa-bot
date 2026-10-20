# HamBot documentation

| Guide | What's in it |
| --- | --- |
| [Deployment](deployment.md) | Quick install, Docker or Local, linking the number, day-to-day commands, switching modes, unattended installs, troubleshooting |
| [Configuration](configuration.md) | Every `.env` setting, with defaults |
| [Commands](commands.md) | All 36 commands and their aliases |
| [Media](MEDIA.md) | Keeping `.video` and `.music` working: yt-dlp, YouTube player clients, PO tokens, the residential proxy |
| [Development](development.md) | Architecture, adding a command, running the tests |
| [Security design](security-architecture.md) | How every request is checked before a command runs |

Something not working? Run `./deploy.sh doctor` first — it checks the whole
setup and prints a fix for each problem. Then see
[Troubleshooting](deployment.md#troubleshooting).
