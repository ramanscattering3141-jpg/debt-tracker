#!/bin/zsh
# Build the app and publish it to GitHub Pages (the gh-pages branch).
set -e
source ~/.zprofile 2>/dev/null || true
cd "$(dirname "$0")/.."
npm test
npm run build
touch dist/.nojekyll
REMOTE=$(git remote get-url origin)
TMP=$(mktemp -d)
cp -R dist/. "$TMP"
cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" -c commit.gpgsign=false commit -qm "Deploy $(date +%Y-%m-%d)"
git -c credential.helper= -c "credential.helper=!$HOME/.local/gh/bin/gh auth git-credential" push -f "$REMOTE" gh-pages
cd - >/dev/null
rm -rf "$TMP"
echo "Deployed. Live in about a minute at https://ramanscattering3141-jpg.github.io/debt-tracker/"
