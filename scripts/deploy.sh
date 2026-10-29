#!/usr/bin/env bash
# Builds the game and publishes it, with its security rules, to the Firebase project.
# Needs the VITE_FIREBASE_* settings (see .env.example). Signs in with a service account key, given either
# whole as FIREBASE_SERVICE_ACCOUNT or as FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY; otherwise with your own
# `npx firebase login`.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
: "${VITE_FIREBASE_PROJECT_ID:?Set VITE_FIREBASE_PROJECT_ID (see .env.example)}"
: "${VITE_FIREBASE_API_KEY:?Set VITE_FIREBASE_API_KEY (see .env.example)}"
creds="$(mktemp)"
trap 'rm -f "$creds"' EXIT
if [ -n "${FIREBASE_SERVICE_ACCOUNT:-}" ]; then
  printf '%s' "$FIREBASE_SERVICE_ACCOUNT" > "$creds"
  export GOOGLE_APPLICATION_CREDENTIALS="$creds"
elif [ -n "${FIREBASE_CLIENT_EMAIL:-}" ]; then
  # The two one-line values from the key file, for settings boxes that cannot hold the whole file. A long key
  # may also be split across FIREBASE_PRIVATE_KEY_1, _2, ... in order.
  node scripts/service-account.mjs > "$creds"
  export GOOGLE_APPLICATION_CREDENTIALS="$creds"
fi
npm run build
# DEPLOY_ONLY narrows what is published, e.g. "hosting,firestore:rules" when the Realtime Database rules are pasted
# in the console instead (Realtime Database → Rules).
npx firebase deploy --project "$VITE_FIREBASE_PROJECT_ID" --only "${DEPLOY_ONLY:-hosting,firestore:rules,database}" --non-interactive
echo "Live at https://${VITE_FIREBASE_PROJECT_ID}.web.app"
