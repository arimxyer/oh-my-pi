#!/usr/bin/env bash
# Rebase the fork's patch branch onto upstream and rebuild the patched omp binary.
#
# Usage: scripts/fork/update-patched-omp.sh [--install [PATH]]
#   --install [PATH]  copy the built binary to PATH (default: the `omp` on PATH),
#                     keeping the replaced binary as PATH.upstream-backup.
#
# Environment:
#   OMP_PATCH_BRANCH  branch holding the patches (default: patches/fullscreen)
#   OMP_UPSTREAM_REF  upstream ref to rebase onto (default: upstream/main; a tag such as v19.2.0 works too)
#
# A rebase conflict stops the script: resolve it, run `git rebase --continue`, then rerun.
# `update.auto: true` (and `omp update`) installs the upstream release over a patched binary.
set -euo pipefail

branch="${OMP_PATCH_BRANCH:-patches/fullscreen}"
upstream_ref="${OMP_UPSTREAM_REF:-upstream/main}"

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
	echo "The working tree has uncommitted changes; commit or stash them first." >&2
	exit 1
fi

git fetch upstream --tags
git switch "$branch"
# The patches are the commits since the branch left upstream/main's history: move only those, so
# a target older than the current base (a release tag) does not keep the upstream commits in between.
patch_base="$(git merge-base HEAD upstream/main)"
git rebase --onto "$upstream_ref" "$patch_base"

bun install
bun run build:native
bun --cwd=packages/coding-agent run build

built="packages/coding-agent/dist/omp"
"$built" --version

if [ "${1:-}" = "--install" ]; then
	target="${2:-$(command -v omp)}"
	if [ -z "$target" ]; then
		echo "No omp on PATH; pass the install path: --install PATH" >&2
		exit 1
	fi
	if [ -e "$target" ]; then cp -p "$target" "$target.upstream-backup"; fi
	install -m 755 "$built" "$target"
	echo "Installed the patched omp at $target"
fi
