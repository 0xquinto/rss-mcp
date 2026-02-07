#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";

const bump = process.argv[2] || "patch";
if (!["major", "minor", "patch"].includes(bump)) {
  console.error(`Usage: node scripts/bump-version.mjs [major|minor|patch]`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);

const next =
  bump === "major"
    ? `${major + 1}.0.0`
    : bump === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

// package.json
pkg.version = next;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

// .claude-plugin/plugin.json
const plugin = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf-8"));
plugin.version = next;
writeFileSync(
  ".claude-plugin/plugin.json",
  JSON.stringify(plugin, null, 2) + "\n",
);

// .claude-plugin/marketplace.json
const marketplace = JSON.parse(
  readFileSync(".claude-plugin/marketplace.json", "utf-8"),
);
marketplace.plugins[0].version = next;
writeFileSync(
  ".claude-plugin/marketplace.json",
  JSON.stringify(marketplace, null, 2) + "\n",
);

console.log(
  `Bumped version: ${pkg.version.replace(next, "")}${major}.${minor}.${patch} → ${next}`,
);
