#!/usr/bin/env bash
# Builds the game and publishes it, with its security rules, to the Firebase project.
# Needs the VITE_FIREBASE_* settings (see .env.example). Signs in with FIREBASE_SERVICE_ACCOUNT (a service
# account key's JSON) when set, otherwise with your own `npx firebase login`.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
: "${VITE_FIREBASE_PROJECT_ID:?Set VITE_FIREBASE_PROJECT_ID (see .env.example)}"
: "${VITE_FIREBASE_API_KEY:?Set VITE_FIREBASE_API_KEY (see .env.example)}"
if [ -n "${FIREBASE_SERVICE_ACCOUNT:-}" ]; then
  creds="$(mktemp)"
  trap 'rm -f "$creds"' EXIT
  printf '%s' "$FIREBASE_SERVICE_ACCOUNT" > "$creds"
  export GOOGLE_APPLICATION_CREDENTIALS="$creds"
fi
npm run build
npx firebase deploy --project "$VITE_FIREBASE_PROJECT_ID" --only hosting,firestore:rules,database --non-interactive
echo "Live at https://${VITE_FIREBASE_PROJECT_ID}.web.app"
