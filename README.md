# Bellmont City

An open-world 3D downtown with a day and night cycle, built with React Three Fiber and Rapier physics.
It runs on Firebase (free Spark plan): Authentication for accounts, Firestore for usernames, saves and rooms,
the Realtime Database for live multiplayer, and Hosting for the website.

## Accounts

- **Sign up** with an email and password, then choose a unique username. **Continue with Google** works too.
- **Sign in** with username (the default) or email, from any browser. Sessions persist across reloads.
- Username sign-in has no server code: `usernames/<name>` stores the account's email encrypted with a key
  derived from its password (src/platform/emailLock.ts), so only the right password recovers it. Signing in
  by email re-locks it, which keeps username sign-in working after a password reset. Google accounts have no
  password and sign in with Google.
- **Saves** are `saves/<uid>/slots/<slot>`: `save` for the player's own city, `room-<CODE>` per room.
- **Guests** play with progress kept in their own browser.

## Multiplayer

After signing in, players choose **Go to my city** or a shared room:

- **Create a room** makes a new random world under a unique 6-character code (`rooms/<CODE>` in Firestore),
  shown in game as `ROOM CODE: …`. A code is never reused while its room exists; the room is deleted when its
  last player leaves.
- **Join a room** loads the world for a typed code. Rooms hold up to 10 players, and share the time of day.
- Each open tab keeps `rooms/<CODE>/peers/<id>` in the Realtime Database (removed on disconnect) with its
  pose, ~30 updates a second while moving; others draw it 80 ms in the past, interpolated, with a username
  label (typewriter font, hidden behind anything in front of it).

## Setup (once)

1. Create a project at https://console.firebase.google.com.
2. **Authentication** → Get started → enable **Email/Password** and **Google**.
3. **Firestore Database** → Create database (production mode).
4. **Realtime Database** → Create database (locked mode).
5. **Project settings** → Your apps → add a **Web app**, and copy its `projectId`, `apiKey` and `appId` into
   `.env.local` (see `.env.example`).

## Development

```sh
npm install
npm test               # unit tests
npm run emulators      # local Firebase (needs Java), in one terminal
npm run dev:emulators  # the game against the local Firebase, in another
npm run deploy         # build and publish to https://<project>.web.app, with the security rules
```
