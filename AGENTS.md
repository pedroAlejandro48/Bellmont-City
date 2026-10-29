## Project rules
- 3D game code lives in src/game (React Three Fiber); pure world/time logic stays in src/game/config.ts so it can be unit-tested without WebGL.
- The app is a static Vite SPA hosted as a claude.ai artifact; there is no server. Accounts and saves go through src/platform (the artifact runtime's `user` and `db` capabilities); see README for the declared capabilities and db rules.
- Player progress is one JSON blob per user at `data/users/<id>/save` (SaveData type in config.ts); add new saved fields there with defaults in DEFAULT_SAVE so old saves still load.
- Save loading validates known fields, retains unknown fields, and blocks gameplay on cloud read failures; user-scoped timestamped local backups recover newer unsynced progress without changing save ownership.
- Sign-in is the viewer's claude.ai identity (no passwords). Usernames are normalized through src/lib/usernames.ts and claimed in `players/<id>` under a short `claims/<name>` lease so two players cannot take one name.
- Multiplayer lives in src/multiplayer. Rooms are `rooms/<CODE>` documents (seed, createdAt) plus a named `room` channel; each player streams their whole pose (body groups, ragdoll parts, scooter) in presence, and peers interpolate it (pose.ts). Each computer moves only its own player: bumping (bump.ts) and spawning beside someone (spawn.ts) are resolved locally against other players' streamed positions. Traffic is simulated per player.
- A room world keeps its seed through deaths, and its clock comes from the room's creation time.
- Guests (and anyone outside claude.ai) play with a browser-local save in GuestGame.
- Health and death reset rules stay pure in config.ts; runtime impact/death state lives in GameState, and saves are serialized so old writes cannot overwrite a reset.
- On-foot movement is ground-only and camera-relative; player facing does not rotate the view. CameraRig owns mouse inactivity and forward-travel timers, saved camera azimuth, and sphere-swept Rapier collision; scooter steering remains heading-based so vehicle controls and obstacles stay coherent.
- CameraRig binds native hold-to-look pointer lock through mouseLook.ts; document-level release, lock-loss and pending-request cleanup prevent stuck hidden cursors and preserve the native cursor return position.
- Rapier runs inside the client-only game Canvas: dynamic mass-bearing vehicles and anatomically limited hinged ragdolls share fixed city colliders; Traffic owns accident time and driving AI, while pure timing, mass, lane and queue rules remain testable without WebGL.
- SaveData stores recoverable accident phase with defaults for older saves; transient vehicle IDs never identify persisted players or overwrite existing progress.

- Stream deterministic scenery by player-centered cells, persist the world seed in SaveData, and change it only on death; all central park layout, furnishings and trees use world-independent configuration so every world shares the same park.
- Instance repeated scenery and recycle traffic outside the visible area; shared wildernessCenter sampling keeps forest clearance, rendered roads and physical traffic on matching paths.
- Keep scenery instance capacities stable, collider keys coordinate-based, and the Canvas subtree memoized independently of HUD ticks; bounded per-axis road markings and reused traffic scratch data avoid generation and animation churn.
- Tree props carry a sidewalk flag: only sidewalk trees render beds, with narrower foliage; ground-floor glazing overlays retain solid building colliders and existing upper-floor facades.
- Save scooter position, orientation, fallen and mounted state in the account save; runtime action phases own E pickup/mount/dismount, while pure interaction, speed and waiting rules stay in config.ts for tests.
- Never add hyphenated DOM-style attributes to src/game JSX: R3F interprets them as nested Three.js properties and crashes.
- Park seats and oriented obstacle footprints are shared pure configuration; a seat is claimed before animation and saved by index, while one interaction dispatcher owns E and all actions share InteractionPrompt to prevent duplicate prompts or conflicting actions.
- Traffic route curves and road membership are pure helpers; seeded road-bound, clearance-checked spawn/recycle and heading-aligned velocity keep random corner turns reproducible and avoid lateral sliding. Vehicle headlights are real local spotlights, and character materials are non-emissive shadow-receiving materials.

- Scooter collider parts share the visible local origin and transform; fallen interaction and foot collision footprints use the same rotated offset, preventing below-wheel collision blocks and unreachable pickup prompts.
