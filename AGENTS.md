<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- 3D game code lives in src/game (React Three Fiber); pure world/time logic stays in src/game/config.ts so it can be unit-tested without WebGL.
- Player progress is one JSON blob per user in `game_saves.data` (SaveData type in config.ts); add new saved fields there with defaults in DEFAULT_SAVE so old saves still load.
- Save loading validates known fields, retains unknown fields, and blocks gameplay on cloud read failures; user-scoped timestamped local backups recover newer unsynced progress without changing save ownership.
- Usernames are normalized through src/lib/usernames.ts and a unique database constraint; username credential resolution is service-role-only inside a server function and never returns email addresses.
- Players without usernames complete the shared UsernameForm before gameplay; email and Google keep the same auth user ID and existing save.
- The game page lives under src/routes/_authenticated (client-only); the sign-in screen is `/`.
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
- Strip development source-inspection DOM attributes from src/game JSX after injection and before React compilation; R3F interprets hyphenated attributes as nested Three.js properties and crashes, while other pages retain source inspection.
- Park seats and oriented obstacle footprints are shared pure configuration; a seat is claimed before animation and saved by index, while one interaction dispatcher owns E and all actions share InteractionPrompt to prevent duplicate prompts or conflicting actions.
- Traffic route curves and road membership are pure helpers; seeded road-bound, clearance-checked spawn/recycle and heading-aligned velocity keep random corner turns reproducible and avoid lateral sliding. Vehicle headlights are real local spotlights, and character materials are non-emissive shadow-receiving materials.

- Scooter collider parts share the visible local origin and transform; fallen interaction and foot collision footprints use the same rotated offset, preventing below-wheel collision blocks and unreachable pickup prompts.
