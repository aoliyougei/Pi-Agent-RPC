import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const lock = JSON.parse(readFileSync("/bridge-package.lock.json", "utf8"));
for (const item of lock.packages) {
  const file = path.join("/vendor", item.file);
  const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (hash !== item.sha256) throw new Error(`Hash mismatch: ${item.file}`);
  const pkg = JSON.parse(execFileSync("tar", ["-xOzf", file, "package/package.json"], { encoding: "utf8" }));
  if (pkg.name !== item.name || pkg.version !== item.version) throw new Error(`Metadata mismatch: ${item.file}`);
}
