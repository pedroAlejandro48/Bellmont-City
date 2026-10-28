# Bellmont City

An open-world 3D downtown with a day and night cycle, built with React Three Fiber and Rapier physics.

## Hosting and accounts

The game is a static single-page app. It is published as a claude.ai artifact, and the claude.ai
artifact runtime provides accounts and saves (`src/platform/`):

- **Sign in** is the viewer's claude.ai login (`user` capability); no passwords are stored.
- **Sign up** reserves a unique Bellmont username in the shared `players/<viewer id>` documents.
- **Saves** go to `data/users/<viewer id>/save` in the artifact's `db`, which is private to each player.
- **Guests** play with progress kept in their own browser.

Players need Contributor access (or above) to the artifact to save; view-only access can only play as a guest.
Opened outside claude.ai (e.g. `npm run dev`), only guest play is available.

Publish with these capabilities:

```json
{
  "db": { "rules": [
    { "path": "players", "read": "view", "write": "owner" },
    { "path": "players/{self}", "read": "view", "write": "interact" }
  ] },
  "user": { "scopes": ["profile"] }
}
```

## Development

```sh
npm install
npm run dev      # local dev server (guest play)
npm test         # unit tests
npm run build    # static build in dist/
```
