# Upstream source

This repository vendors an unmodified Pi source snapshot for reproducible builds.

- Repository: https://github.com/earendil-works/pi
- Version: `0.84.4`
- Revision: `b79e4cc834970cca69daebffab7df1da7d1e52c4`
- Path: `source/upstream/pi`

`tests/verify-upstream.sh` compares this tree byte-for-byte with the retained `pi-agent:v0.2.5` source baseline. Agent RPC integration belongs to the separately packaged Pi Web Agent Server and must not patch this snapshot.
