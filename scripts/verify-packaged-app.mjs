#!/usr/bin/env node
/**
 * Guard against packaging bugs and ensure release builds include current
 * Lamp & Light desktop features (IPC, preload bridge, macOS chrome).
 *
 * Usage:
 *   node scripts/verify-packaged-app.mjs <path-to-.app-or-resources>
 *   node scripts/verify-packaged-app.mjs "release/mac-arm64/Lamp Light.app"
 *   node scripts/verify-packaged-app.mjs release/win-unpacked/resources
 */
import asar from "@electron/asar";
import fs from "node:fs";
import path from "node:path";

const MAX_ASAR_BYTES = 80 * 1024 * 1024; // 80MB — real app ~37MB; broken pack was ~960MB

function findAsar(root) {
  const direct = path.join(root, "app.asar");
  if (fs.existsSync(direct)) return direct;
  const nested = path.join(root, "Contents", "Resources", "app.asar");
  if (fs.existsSync(nested)) return nested;
  const resources = path.join(root, "resources", "app.asar");
  if (fs.existsSync(resources)) return resources;
  throw new Error(`No app.asar under ${root}`);
}

function findInfoPlist(root) {
  const nested = path.join(root, "Contents", "Info.plist");
  if (fs.existsSync(nested)) return nested;
  return null;
}

function mustInclude(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    console.error(`FAIL: ${label} missing ${JSON.stringify(needle)}`);
    process.exit(1);
  }
}

const root = process.argv[2];
if (!root) {
  console.error(
    'Usage: node scripts/verify-packaged-app.mjs <app-or-resources-dir>',
  );
  process.exit(2);
}

const resolvedRoot = path.resolve(root);
const asarPath = findAsar(resolvedRoot);
const { size } = fs.statSync(asarPath);
console.log(`app.asar: ${asarPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);

if (size > MAX_ASAR_BYTES) {
  console.error(
    `FAIL: app.asar is ${(size / 1024 / 1024).toFixed(0)}MB (limit ${MAX_ASAR_BYTES / 1024 / 1024}MB). ` +
      "Builder output was probably packed into the asar. Use directories.output=release and narrow build.files.",
  );
  process.exit(1);
}

const preload = asar.extractFile(asarPath, "electron/preload.cjs").toString("utf8");
if (!preload.startsWith("const { contextBridge")) {
  console.error("FAIL: electron/preload.cjs inside asar is corrupted or wrong file.");
  console.error("First bytes:", Buffer.from(preload).subarray(0, 40));
  process.exit(1);
}
mustInclude(preload, "onNavigate", "preload.cjs");
mustInclude(preload, "onShareVotd", "preload.cjs");
mustInclude(preload, "app:navigate", "preload.cjs");
mustInclude(preload, "app:share-votd", "preload.cjs");

const html = asar.extractFile(asarPath, "dist/index.html").toString("utf8");
if (!html.includes("<!doctype html") && !html.includes("<!DOCTYPE html")) {
  console.error("FAIL: dist/index.html missing or invalid inside asar.");
  process.exit(1);
}

const main = asar
  .extractFile(asarPath, "dist-electron/electron/main.js")
  .toString("utf8");
mustInclude(main, "whenReady", "main.js");
mustInclude(main, "createMainWindow", "main.js");
mustInclude(main, 'profile:custom-avatar', "main.js");
mustInclude(main, "custom_avatar_path", "main.js");
mustInclude(main, "reminder:get", "main.js");
mustInclude(main, "reminder:set", "main.js");
mustInclude(main, "share:clipboard", "main.js");
mustInclude(main, "installApplicationMenu", "main.js");
mustInclude(main, "syncDockBadge", "main.js");
mustInclude(main, 'app.on("activate"', "main.js");

const macos = asar
  .extractFile(asarPath, "dist-electron/electron/macos.js")
  .toString("utf8");
mustInclude(macos, "configureAboutPanel", "macos.js");
mustInclude(macos, "refreshDockBadge", "macos.js");
mustInclude(macos, "showDailyReminderNotification", "macos.js");
mustInclude(macos, "badgeForDailyUnanswered", "macos.js");

const migrations = asar
  .extractFile(asarPath, "dist-electron/electron/migrations.js")
  .toString("utf8");
mustInclude(migrations, "custom_avatar_path", "migrations.js");

const pkg = JSON.parse(
  asar.extractFile(asarPath, "package.json").toString("utf8"),
);
if (pkg.name !== "lamp-light") {
  console.error(`FAIL: package.json name is ${pkg.name}, expected lamp-light`);
  process.exit(1);
}
if (pkg.build?.productName && pkg.build.productName !== "Lamp & Light") {
  console.error(
    `FAIL: productName is ${pkg.build.productName}, expected Lamp & Light`,
  );
  process.exit(1);
}

const infoPlistPath = findInfoPlist(resolvedRoot);
if (infoPlistPath) {
  const plist = fs.readFileSync(infoPlistPath, "utf8");
  mustInclude(plist, "org.lamplight.desktop", "Info.plist CFBundleIdentifier");
  mustInclude(plist, "Lamp", "Info.plist display name");
  mustInclude(
    plist,
    "public.app-category.education",
    "Info.plist LSApplicationCategoryType",
  );
  mustInclude(
    plist,
    "NSUserNotificationUsageDescription",
    "Info.plist notification usage (macOS reminders)",
  );
  console.log(`Info.plist: ${infoPlistPath} OK`);
}

console.log("OK: packaged Lamp & Light asar matches current desktop features.");
