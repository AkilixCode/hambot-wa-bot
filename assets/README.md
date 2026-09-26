# assets

Drop a picture here named `menu.jpg` (or `menu.jpeg`, `menu.png`, `menu.webp`)
and `.menu` sends it on top of the menu instead of the generated banner.

- A landscape image around 1280×640 looks best in the chat bubble.
- Any size works: it is resized to at most 1280px wide and re-encoded as JPEG.
- Setting `MENU_IMAGE` in `.env` (a file path or an http(s) URL) takes
  priority over this folder.
- Changes are picked up on the next `.menu`; no restart needed.
