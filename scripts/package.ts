import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const root = fromFileUrl(new URL("../", import.meta.url));
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

async function readManifest(path: string) {
  const text = await Deno.readTextFile(join(root, path));
  return JSON.parse(text);
}

const chromeManifest = await readManifest("manifest.json");
const firefoxManifest = await readManifest("manifest.firefox.json");

if (chromeManifest.version !== firefoxManifest.version) {
  throw new Error(
    `Manifest versions differ: Chrome ${chromeManifest.version}, Firefox ${firefoxManifest.version}`,
  );
}

if (!/^\d+\.\d+\.\d+$/.test(chromeManifest.version)) {
  throw new Error(`Invalid release version: ${chromeManifest.version}`);
}

const { browser_specific_settings: _firefoxSettings, ...firefoxShared } =
  firefoxManifest;
assertEquals(
  firefoxShared,
  chromeManifest,
  "Firefox manifest must match manifest.json except for browser_specific_settings",
);

async function removeIfExists(path: string) {
  await Deno.remove(path, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
}

await removeIfExists(packageRoot);
await Deno.mkdir(stagingRoot, { recursive: true });

const archiveNames: string[] = [];
let packageComplete = false;

try {
  for (const target of targets) {
    const staging = join(stagingRoot, target.browser);
    await Deno.mkdir(staging, { recursive: true });

    for (const file of sharedFiles) {
      const destination = join(staging, file);
      await Deno.mkdir(dirname(destination), { recursive: true });
      await Deno.copyFile(join(root, file), destination);
    }

    await Deno.copyFile(
      join(root, target.manifest),
      join(staging, "manifest.json"),
    );

    const archiveName =
      `ytshorts-speed-control-v${chromeManifest.version}-${target.browser}.zip`;
    const archive = join(packageRoot, archiveName);
    const packageFiles = ["manifest.json", ...sharedFiles];

    let output;
    try {
      output = await new Deno.Command("zip", {
        args: ["-q", "-X", archive, ...packageFiles],
        cwd: staging,
        stderr: "piped",
      }).output();
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error("Packaging requires the `zip` command on PATH");
      }
      throw error;
    }

    if (!output.success) {
      const message = new TextDecoder().decode(output.stderr).trim();
      throw new Error(`zip failed for ${target.browser}: ${message}`);
    }

    archiveNames.push(archiveName);
  }

  await removeIfExists(stagingRoot);
  await removeIfExists(dist);
  await Deno.rename(packageRoot, dist);
  packageComplete = true;
} finally {
  if (!packageComplete) await removeIfExists(packageRoot);
}

for (const archiveName of archiveNames) {
  console.log(join(dist, archiveName));
}
