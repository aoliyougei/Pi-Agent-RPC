import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = "/build/pi";
const output = "/artifacts/pi-packages";
const dirs = [
  ...readdirSync(path.join(root, "packages")).map((name) => path.join(root, "packages", name)),
  path.join(root, "packages/session-backends/sqlite-node"),
];
const packages = new Map();
for (const dir of dirs) {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  if (pkg.name?.startsWith("@earendil-works/pi-")) packages.set(pkg.name, { dir, pkg });
}
const needed = new Set(["@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-tui"]);
const queue = [...needed];
while (queue.length) {
  const name = queue.pop();
  const item = packages.get(name);
  if (!item) throw new Error(`Missing Pi package: ${name}`);
  for (const dependency of Object.keys(item.pkg.dependencies ?? {})) {
    if (packages.has(dependency) && !needed.has(dependency)) {
      needed.add(dependency);
      queue.push(dependency);
    }
  }
}
const manifest = [];
for (const name of [...needed].sort()) {
  const item = packages.get(name);
  const file = execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", output], { cwd: item.dir, encoding: "utf8" }).trim().split(/\n/).pop();
  const full = path.join(output, file);
  manifest.push({ name, version: item.pkg.version, file, sha256: createHash("sha256").update(readFileSync(full)).digest("hex") });
}
writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify({ packages: manifest }, null, 2)}\n`);
