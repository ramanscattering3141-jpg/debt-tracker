#!/bin/zsh
# Pushing to main deploys automatically. This re-runs the deploy without a new commit.
set -e
source ~/.zprofile 2>/dev/null || true
cd "$(dirname "$0")/.."
gh workflow run deploy.yml --ref main
echo "Deploy started. Live in about a minute at https://ramanscattering3141-jpg.github.io/debt-tracker/"
