#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
node - <<'NODE'
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const lock = require("./bridge-package.lock.json");
if (lock.pi.version !== "0.84.4" || lock.pi.revision !== "b79e4cc834970cca69daebffab7df1da7d1e52c4") throw new Error("unexpected locked Pi");
const expectedFiles = lock.packages.map((item) => item.file).sort();
const actualFiles = fs.readdirSync("vendor").filter((file) => file.endsWith(".tgz")).sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error("unexpected vendor artifacts");
for (const item of lock.packages) {
  const file = path.join("vendor", item.file);
  const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (digest !== item.sha256) throw new Error(`hash mismatch: ${item.file}`);
  const packageJson = JSON.parse(execFileSync("tar", ["-xOzf", file, "package/package.json"], { encoding: "utf8" }));
  if (packageJson.name !== item.name || packageJson.version !== item.version) throw new Error(`metadata mismatch: ${item.file}`);
  if (item.name === "@aoliyougei/pi-web-agent-server") {
    if (item.compatiblePiVersion !== "0.84.4" || packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"] !== "0.84.4") throw new Error("Agent Server Pi compatibility mismatch");
  }
}
NODE
printf '%s\n' "Agent Server artifacts verified"
