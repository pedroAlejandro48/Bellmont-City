# Bellmont City

An open-world 3D downtown with a day and night cycle, built with React Three Fiber and Rapier physics.

## Hosting and accounts

The game is a static single-page app. It is published as a claude.ai artifact, and the claude.ai
artifact runtime provides accounts and saves (`src/platform/`):

- **Sign in** is the viewer's claude.ai login (`user` capability); no passwords are stored.
- **Sign up** reserves a unique Bellmont username in the shared `players/<viewer id>` documents.
- **Saves** go to `data/users/<viewer id>/save` in the artifact's `db`, which is private to each player.
- **Guests** play with progress kept in their own browser.

After signing in, players choose **Go to my city** (their own world and save) or a shared room:

- **Create a room** makes a new random world under a unique 6-character code (`rooms/<CODE>`), shown in game as
  `ROOM CODE: …`. A code is never reused while its room exists; the room is deleted when its last player leaves.
- **Join a room** loads the world for a typed code. Rooms hold up to 10 players. Each player's progress in a room
  is saved separately (`data/users/<id>/room-<CODE>`), and everyone shares the room's time of day.
- Players see each other live (`room` capability presence: each player's pose, ~15 updates a second, drawn
  110 ms in the past and interpolated), bump into each other, and the top-left counter lists who is here.

Players need Contributor access (or above) to the artifact to save; view-only access can only play as a guest.
Opened outside claude.ai (e.g. `npm run dev`), only guest play is available.

Publish with these capabilities:

```json
{
  "db": { "rules": [
    { "path": "players", "read": "view", "write": "owner" },
    { "path": "players/{self}", "read": "view", "write": "interact" }
  ] },
  "user": { "scopes": ["profile"] },
  "room": {}
}
```

## Development

```sh
npm install
npm run dev      # local dev server (guest play)
npm test         # unit tests
npm run build    # static build in dist/
```
