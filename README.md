# YT Shorts Speed Control

Control YouTube Shorts playback speed with a popup or mpv-style keyboard
shortcuts. Keep your chosen speed as you move between Shorts, and opt in to use
the same controls on regular videos.

For Chrome, Chromium-based browsers, and Firefox desktop 140 or newer.

<p>
  <img src="docs/examples/popup-example.png" width="336" alt="Speed control popup on YouTube with the 2x preset selected, a speed slider, custom input, and keyboard shortcuts." />
  <img src="docs/examples/example-on-non-yt-webpage.png" width="336" alt="The same popup on another website, with the saved 2x speed and a message to open a YouTube tab." />
</p>

## Install

Download the ZIP for your browser from the
[latest release](https://github.com/hawkff/ytshorts-speed-control/releases/latest).
You do not need Bun to install a release.

### Chrome and Chromium-based browsers

1. Download the file ending in `-chrome.zip` and extract it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing
   `manifest.json`.
4. Open a YouTube Short. Reload any YouTube tabs you had open before installing.

You can also load this repository's root folder without a build step.

### Firefox desktop

1. Download the file ending in `-firefox.zip` and extract it.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and select `manifest.json` in the extracted
   folder.
4. Open a YouTube Short. Reload any YouTube tabs you had open before installing.

Firefox requires version 140 or newer. This is a temporary install that Firefox
removes when you close the browser. The release ZIP is unsigned; a permanent
install requires Mozilla signing.

## Set your speed

Click the extension icon while you have a YouTube tab open.

- Choose a preset: 0.25x, 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x, 2.5x, 3x, or 4x.
- Drag the slider between 0.25x and 4x in steps of 0.05x.
- Enter a custom speed from 0.1x to 16x and click **Set**.
- Click **Reset to 1x** to return to normal speed.

Your speed carries over to the next Short and stays saved between browser
sessions. A brief on-screen badge shows speed changes. If you change the speed
while a video is paused, it takes effect when playback resumes.

To use these controls on regular YouTube videos, check **Also control regular
videos** in the popup. The setting is off by default. Turning it off returns the
current regular video to 1x.

On other websites, the popup prompts you to open YouTube. You can still save a
speed there for your next visit.

### Keyboard shortcuts

Use these while watching a Short, or a regular video with the setting enabled.

| Key         | Action                  |
| ----------- | ----------------------- |
| `]`         | Increase speed by 0.25x |
| `[`         | Decrease speed by 0.25x |
| `Backspace` | Reset to 1x             |
| `P`         | Pause or play           |

Shortcuts do not run while you type in a search box, comment, or other input.
Browser shortcuts such as `Ctrl`/`Cmd` + `[` and `Ctrl`/`Cmd` + `P` keep their
normal behavior.

## Privacy and permissions

The extension makes no network requests and includes no analytics or tracking.
It stores your speed and settings on your device with `storage.local`, not
browser sync.

It requests two permissions:

- `storage` to remember your speed and settings.
- Access to `https://www.youtube.com/*` and `https://m.youtube.com/*` to control
  video playback and handle shortcuts on YouTube.

## Development

The extension is plain JavaScript, HTML, and CSS with no build step, so the
files in this repository are the files that ship. Load the repository in Chrome
to try changes. The development tasks need [Bun](https://bun.sh/) 1.4 or newer.

```sh
bun install      # Install Biome, the formatter and linter
bun test         # Run tests
bun run check    # Check formatting and lint, then run tests
bun run package  # Create Chrome and Firefox ZIPs in dist/
```

Run `bunx biome check --write` to format the source and apply safe lint fixes.
Packaging also requires the `zip` command.

The content script and popup share `lib/speed.js` and `lib/settings.js`. MV3
content scripts can't load ES modules without a bundler, so these files are
classic scripts that attach their API to `globalThis`.

`manifest.json` targets Chrome. `manifest.firefox.json` must match it except for
the Firefox metadata in `browser_specific_settings`, and the packaging script
puts the matching manifest in each archive. The ZIPs contain only the files
listed in `sharedFiles` in `scripts/package.js`, so add any new runtime file
there. Tests cover speed calculations, settings, popup interactions,
content-script behavior, and manifest consistency.

### Releasing

1. Bump `version` in both manifests.
2. Run `bun run check` and commit.
3. Tag the commit `v<version>` and push the tag.

The release workflow checks that the tag matches the manifest version, builds
both ZIPs, and publishes a GitHub release with them.

## License

[AGPL-3.0-or-later](LICENSE)
