#!/bin/zsh
# Build the web app, copy it into the iOS project and open Xcode.
# In Xcode: pick your iPhone 15 as the run destination, set Signing > Team to your Apple ID, press ▶.
set -e
source ~/.zprofile 2>/dev/null || true
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install
npm run build
npx cap sync ios
npx cap open ios
