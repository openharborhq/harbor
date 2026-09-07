#!/usr/bin/env bash
# Build and (optionally) push multi-arch images. The appliance is x86-64; developers are on
# Apple Silicon; the images must run on both (spec §3.7).
#
#   scripts/build-images.sh                 # local single-arch build, loaded into the docker daemon
# CI does the same on every push to main (.github/workflows/images.yml); this is for a laptop.
#   scripts/build-images.sh --push v0.1.0   # linux/amd64 + linux/arm64, pushed to $HARBOR_IMAGE_PREFIX-*:v0.1.0
#
# Requires docker buildx. For --push, `docker login ghcr.io` first.
set -euo pipefail

cd "$(dirname "$0")/.."
PREFIX="${HARBOR_IMAGE_PREFIX:-ghcr.io/openharborhq/harbor}"
PUSH=0
TAG="dev"
if [ "${1:-}" = "--push" ]; then
  PUSH=1
  TAG="${2:?tag required with --push, e.g. v0.1.0}"
fi

for svc in api worker web backup; do
  if [ "$PUSH" = 1 ]; then
    docker buildx build \
      --platform linux/amd64,linux/arm64 \
      -f "infra/docker/${svc}.Dockerfile" \
      -t "${PREFIX}-${svc}:${TAG}" -t "${PREFIX}-${svc}:latest" \
      --push .
  else
    docker buildx build \
      -f "infra/docker/${svc}.Dockerfile" \
      -t "${PREFIX}-${svc}:${TAG}" \
      --load .
  fi
done

echo "built: ${PREFIX}-{api,worker,web,backup}:${TAG}$([ "$PUSH" = 1 ] && echo ' (pushed, multi-arch)')"
