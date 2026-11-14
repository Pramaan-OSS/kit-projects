#!/bin/sh
set -eu
cd /work
start=$(date +%s)
pnpm --config.verify-deps-before-run=warn generate
pnpm --config.verify-deps-before-run=warn lint
pnpm --config.verify-deps-before-run=warn typecheck
pnpm --config.verify-deps-before-run=warn build
end=$(date +%s)
printf '{"seconds":%s,"peakBytes":%s}\n' "$((end-start))" "$(cat /sys/fs/cgroup/memory.peak)" > /results/verifier-measured.json
