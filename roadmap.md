- [x] Make corner turns faster but natural; restore fallen-bike E priority and tighten the physical bike bounds to its wheels.
- [x] Shade the white character naturally and smooth sunrise/sunset; add always-on environmental vehicle headlights and scooter braking lamps.
- [x] Add two-seat bench E interactions, occupancy, natural sitting/standing and shared solid park obstacles; rebuild entrance arch and flush paths/obelisk.
- [x] Collide scooter with all props and allow heavier-bike pushing without player clipping.
- [x] Keep traffic road-bound and spaced/staggered; add moving random corner turns and continuing four-lane main roads.
- [x] Run 75 rule tests; verify signed-in bench sit/stand, day/night shading, tree collision and fallen-bike E pickup without cloud save writes.

Validation limit: random traffic corner completion, every prop collision and full sitting/pickup animation realism still need real-device playtesting; software-rendered checks confirm the E pickup completes and the character responds to light without runtime errors.
- [x] Reduce streaming work with bounded markings, stable instances/colliders, memoized scene and reused traffic data; smooth camera angles without changing controls/saves.
- [x] Build a fixed pebble-path park with circular lawn, gray obelisk and matching benches; reduce other green blocks.
- [x] Restrict tree beds to sidewalks, center them safely, and keep foliage clear of buildings.
- [x] Add closed double-door entrances and large ground-floor windows; world rules pass and signed-in scenery/riding render without runtime errors.

Validation limit: software-rendered browser confirms visible scenery and movement but cannot establish smooth real-device frame rates or sustained high-speed streaming performance.
- [x] Add vehicle impacts, saved health, dramatic death, and five-second full reset.
- [x] Change left/right to turning with a behind-player camera.
- [x] Test gameplay rules and verify signed-in damage/reset flow.
- [x] Add default username login, email toggle, and unique username enrollment.
- [x] Preserve saves across updates and recover from save/load failures.
- [x] Test signed-in username enrollment, uniqueness/privacy, saved-game reload, and interrupted loading/writing.
- [x] Add physical ragdolls, throw distance, nonfatal recovery, and saved accident state.
- [x] Add braking, left bypass, delayed traffic queues, and mass-sensitive vehicle collisions.
- [x] Verify physical accidents, queue timing, and recovery in the signed-in game.
- [x] Restore full mouse orbit, ramped turning, and camera obstacle avoidance.
- [x] Thicken the animated body and constrain ragdoll flexibility.
- [x] Generate varied branching trees and a landscaped central park with a fixed Bellmont City entrance.
- [x] Stream a seeded bounded downtown and endless forest roads with traffic; regenerate only on death.
- [x] Rename the login title and tagline, test world/save rules, and verify signed-in gameplay.
- [x] Add a saved gas scooter, half-meter E interaction, camera-facing fading prompt, mount/recovery animations and speedometer.
- [x] Set regular traffic to 30 mph and scooter maximum to 45 mph; add scooter crash, fallen-bike pickup and 15-second traffic bypass rules.
- [x] Test scooter interaction/speed/traffic rules and verify E mounting, riding, full-stop dismount and two-press pickup/remount in a signed-in browser.
- [x] Recenter camera behind forward movement; remove waist, join diagonal legs, and loosen immediate impact motion without separating limbs.
- [x] Throw the intact scooter on crashes; synchronize rider tilt, steer only the front wheel at rest, and permit reverse-animation dismount only at a full stop.
- [x] Lock hands to handlebars through mounting and riding; verify mounted appearance and run all 41 tests.
- [x] Remove incompatible preview source labels from 3D objects; regression tests pass and signed-in movement/turning rendered with no browser errors, without writing cloud saves.

- [x] Restore camera-relative on-foot walking/running and original sideways keys; delay camera recentering until more than one second of forward movement without mouse input; unit tests and signed-in mouse/movement checks pass without cloud writes.
- [x] Add slower scooter reverse driving, with right hand on handlebar, left hand on rear seat, backward torso/head pose, and smooth return to forward pose when stopped; signed-in E mount, initial reverse displacement and return to zero speed verified.

Validation limit: long-range road/ring traffic, repeated scooter crash queues, and collision clearance against every vehicle were not fully browser-playtested; timing and speed rules passed unit tests.
Validation limit for latest controls: the software-rendered browser runs too slowly to verify the full reverse-pose transition or camera-delay timing visually; pure one-second timing, reverse cap, braking, steering and movement tests pass.- [x] Get up 2 s after a hit; limbs splay in flight; staged stand-up (all fours, planted right foot, balancing arms); squat-and-lift bike pickup; pickup/mount from either side, dismount always right; one shared E sign for all actions (incl. stopped dismount).
- [x] Jump onto bench seat, second jump onto narrow backrest top, walk off to fall back down
- [x] Hold mouse button for native hidden-pointer, unlimited camera look; unlock on release, focus loss and Escape. Ten control tests and signed-in lock/release checks pass without save writes; native cursor position restoration needs a physical mouse check.
