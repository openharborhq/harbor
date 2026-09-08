#!/usr/bin/env bash
# Cut a release.
#
#   scripts/release.sh v0.5.0            # check, bump, tag, push, publish, watch CI
#   scripts/release.sh v0.5.0 --dry-run  # say what it would do and change nothing
#
# Doing this by hand is five steps in four files, and getting one wrong ships a release whose
# default version points at the release it was meant to fix — which is exactly what happened on
# 2026-09-08. Everything here is a step that was previously remembered.
set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
info() { printf '  %s\n' "$1"; }
die()  { printf '\n\033[31mstopped: %s\033[0m\n' "$1" >&2; exit 1; }

VERSION="${1:-}"
DRY=0
[ "${2:-}" = "--dry-run" ] && DRY=1
[ -n "$VERSION" ] || die "usage: scripts/release.sh vMAJOR.MINOR.PATCH [--dry-run]"
echo "$VERSION" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$' || die "'$VERSION' is not vMAJOR.MINOR.PATCH"

say "Checking the ground is solid"

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "not on main; releases come from main."
[ -z "$(git status --porcelain)" ] || die "the working tree has uncommitted changes. Commit them first — a release should be a commit you can point at."
git fetch --quiet origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main and origin/main differ. Push or pull first."
ok "on main, clean, in step with origin"

git rev-parse "$VERSION" >/dev/null 2>&1 && die "$VERSION already exists. Pick the next number; published tags are not moved."
ok "$VERSION is unused"

# The changelog is the only part of a release nobody can generate for you, so it is the one thing
# this refuses to proceed without.
grep -q "^## $VERSION " CHANGELOG.md || die "CHANGELOG.md has no '## $VERSION — <date>' section. Write what changed before tagging it."
ok "CHANGELOG.md describes $VERSION"

PREV=$(git tag -l 'v*' --sort=v:refname | tail -1)
[ -n "$PREV" ] && info "previous release: $PREV ($(git rev-list --count "$PREV"..HEAD) commits since)"

say "Running what CI runs"
pnpm lint    >/dev/null 2>&1 || die "lint failed. 'pnpm lint' to see it."
ok "lint"
pnpm typecheck >/dev/null 2>&1 || die "typecheck failed. 'pnpm typecheck' to see it."
ok "typecheck"
pnpm test    >/dev/null 2>&1 || die "tests failed. 'pnpm test' to see them."
ok "tests"

# Two files carry the version a fresh install lands on. Both, or a new install gets the old one.
say "Pointing fresh installs at $VERSION"
FILES="install.sh infra/compose.prod.yml"
CURRENT=$(grep -oE 'HARBOR_IMAGE_TAG:-v[0-9]+\.[0-9]+\.[0-9]+' install.sh | head -1 | sed 's/.*-//')
[ -n "$CURRENT" ] || die "could not find the current default version in install.sh"
info "$CURRENT -> $VERSION in: $FILES"
if [ "$DRY" = 1 ]; then
  say "Dry run — nothing was changed"
  info "would commit, tag $VERSION, push, publish a GitHub release and watch CI"
  exit 0
fi
for f in $FILES; do
  sed -i.bak "s/${CURRENT}/${VERSION}/g" "$f" && rm -f "$f.bak"
done
# Prove it, rather than trust the substitution: this is the step that went wrong by hand.
for f in $FILES; do
  grep -q "$VERSION" "$f" || die "$f still does not mention $VERSION"
  grep -q "$CURRENT" "$f" && die "$f still mentions $CURRENT"
done
ok "both files updated and verified"

say "Tagging and pushing"
git add $FILES
git commit -q -m "Release $VERSION

Point fresh installs at $VERSION. See CHANGELOG.md."
git tag -a "$VERSION" -m "$VERSION"$'\n\n'"$(awk "/^## $VERSION /{f=1;next} /^## v/{f=0} f" CHANGELOG.md)"
git push -q origin main
git push -q origin "$VERSION"
ok "pushed $(git rev-parse --short HEAD) and $VERSION"

# The Releases page is where people look; tags alone leave it empty.
if command -v gh >/dev/null 2>&1; then
  if awk "/^## $VERSION /{f=1;next} /^## v/{f=0} f" CHANGELOG.md | gh release create "$VERSION" --title "$VERSION" --notes-file - >/dev/null 2>&1; then
    ok "published the GitHub release"
  else
    info "could not publish the GitHub release; the tag is pushed, so 'gh release create $VERSION' still works"
  fi
fi

say "Waiting for CI to build and smoke-test the images"
sleep 10
RUN=$(gh run list --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
if [ -z "$RUN" ]; then
  info "could not find the run; watch it at https://github.com/openharborhq/harbor/actions"
  exit 0
fi
if gh run watch "$RUN" --exit-status >/dev/null 2>&1; then
  ok "images built and every service started"
  say "$VERSION is out"
  info "on the appliance:  sudo harbor upgrade"
else
  gh run view "$RUN" --json jobs -q '.jobs[] | "  " + .name + "  " + .conclusion' 2>/dev/null || true
  die "CI failed. The tag is pushed but the images may be missing or broken — fix and cut a patch release."
fi
