#!/bin/sh
set -eu
REFERENCE=${1:?usage: verify-upstream.sh OFFICIAL_PI_1_2_0_DIR}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
diff -qr "$REFERENCE" source/upstream/pi
node --input-type=commonjs - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const manifest = JSON.parse(fs.readFileSync('SOURCE_MANIFEST.json', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('source/upstream/pi/packages/coding-agent/package.json', 'utf8'));
assert.equal(manifest.project.version, '0.2.0');
assert.equal(manifest.pi.version, '1.2.0');
assert.equal(manifest.pi.revision, '06a466935536f8c9bcacb2d5efc0fc021be1bdff');
assert.equal(manifest.pi.path, 'source/upstream/pi');
assert.equal(pkg.version, manifest.pi.version);
NODE
printf '%s\n' 'Pi upstream verification passed'
