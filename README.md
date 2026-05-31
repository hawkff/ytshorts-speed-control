# YT Shorts Speed Control

A Chrome extension to control YouTube playback speed with mpv-like
keybindings. Built for Shorts, with optional support for regular videos.

## Features

- **Presets** — one-click speeds: 0.25x, 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x,
  2.5x, 3x, 4x
- **Slider** — drag for fine control between 0.25x and 4x
- **Custom input** — type any speed from 0.1x up to 16x
- **Keyboard shortcuts** (mpv-style) — see the table below
- **Persists your chosen speed** and re-applies it as YouTube swaps between
  Shorts (which otherwise reset to 1x)
- **On-screen badge** shows the speed when it changes
- **Optional: regular videos** — off by default; enable in the popup to use the
  same speed control and shortcuts on normal videos

### Keyboard shortcuts

| Key         | Action                  |
| ----------- | ----------------------- |
| `]`         | Increase speed by 0.25x |
| `[`         | Decrease speed by 0.25x |
| `Backspace` | Reset speed to 1.0x     |
| `P`         | Pause / play            |

## Local install / testing

1. Clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder
5. Open a YouTube Short and set the speed from the popup or with the keyboard
   shortcuts

## Usage

- On a Short (or a regular video with the setting enabled), use the popup
  controls or the keyboard shortcuts above.
- The keyboard shortcuts are ignored while you're typing in a field (search,
  comments) and don't hijack browser combos like `Cmd`/`Ctrl`+`[`.
- To control normal videos, open the popup and tick **"Also control regular
  videos"**. Turning it back off resets the current video to 1x.

## Examples

The popup on a YouTube page, and on a non-YouTube page (where it prompts you to
open YouTube):

![Extension popup](docs/examples/popup-example.png)
![Popup on a non-YouTube page](docs/examples/example-on-non-yt-webpage.png)

## Development

This project uses [Deno](https://deno.com) for formatting, linting, and tests
(no `node_modules`, no build step).

```bash
deno task test     # run unit tests
deno task check    # fmt --check + lint + test
deno fmt           # format
deno lint          # lint
```

The helpers in `lib/speed.js` are covered by unit tests in
`tests/speed_test.js`.

## Privacy and permissions

This extension is privacy-respecting by design: it makes **no network
requests**, collects **no data**, and includes **no tracking or analytics**.
Your chosen speed and settings are stored locally on your device via the
browser's storage API.

- **Storage** — to remember your chosen speed and settings
- **Host access to `youtube.com`** — to read/adjust the video element on
  YouTube pages

No data leaves your browser.

## License

[AGPL-3.0-or-later](LICENSE) © hawkff
