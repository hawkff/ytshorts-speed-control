import { deepStrictEqual } from "node:assert/strict";
import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");
const packageRoot = join(root, ".package-tmp");
const stagingRoot = join(packageRoot, ".staging");

const sharedFiles = [
  "LICENSE",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "lib/settings.js",
  "lib/speed.js",
  "src/content.js",
  "src/popup.css",
  "src/popup.html",
  "src/popup.js",
];

const targets = [
  { browser: "chrome", manifest: "manifest.json" },
  { browser: "firefox", manifest: "manifest.firefox.json" },
];

async function readManifest(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

const chromeManifest = await readManifest("manifest.json");
const firefoxManifest = await readManifest("manifest.firefox.json");

if (!/^\d+\.\d+\.\d+$/.test(chromeManifest.version)) {
  throw new Error(`Invalid release version: ${chromeManifest.version}`);
}

const { browser_specific_settings: _firefoxSettings, ...firefoxShared } =
  firefoxManifest;
deepStrictEqual(
  firefoxShared,
  chromeManifest,
  "Firefox manifest must match manifest.json except for browser_specific_settings",
);

const removeTree = (path) => rm(path, { recursive: true, force: true });

await removeTree(packageRoot);

const archiveNames = [];
let packageComplete = false;

try {
  for (const target of targets) {
    const staging = join(stagingRoot, target.browser);

    for (const file of sharedFiles) {
      const destination = join(staging, file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(root, file), destination);
    }

    await copyFile(join(root, target.manifest), join(staging, "manifest.json"));

    const archiveName = `ytshorts-speed-control-v${chromeManifest.version}-${target.browser}.zip`;
    // Bun Shell throws on a non-zero exit and reports a missing `zip` itself.
    await $`zip -q -X ${join(packageRoot, archiveName)} manifest.json ${sharedFiles}`.cwd(
      staging,
    );

    archiveNames.push(archiveName);
  }

  await removeTree(stagingRoot);
  await removeTree(dist);
  await rename(packageRoot, dist);
  packageComplete = true;
} finally {
  if (!packageComplete) await removeTree(packageRoot);
}

for (const archiveName of archiveNames) {
  console.log(join(dist, archiveName));
}
