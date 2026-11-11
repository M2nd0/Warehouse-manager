# Warehouse Manager

3D web warehouse management simulator. Design doc: docs/GDD.md (source of truth for game rules and numbers).

## Stack
TypeScript strict, Vite, Three.js, Preact overlay UI, Vitest. No other game framework.

## Commands
- `npm run dev` – dev server. The game autosaves to IndexedDB at the end of every in-game day and continues from there; `?new` starts over, `?seed=42` starts a fixed game, `?starter` a game with a ready-made rack layout and both clients. Dev builds expose `window.sim`, `window.view` and `window.store`.
- `npm run test` – Vitest (`tests/`, runs in Node)
- `npm run typecheck` – app + a second pass that compiles `src/sim` and `src/data` without DOM/Node typings
- `npm run lint` – ESLint (also forbids Three.js/UI imports, `Math.random` and `Date.now` inside `src/sim`)
- `npm run build` – typecheck + production build
- `npm run sim -- [days] [seed] [workers]` – headless run that prints the daily reports
- `npm run test:e2e` – Playwright smoke test of the built game (`npm run build` first; needs `npx playwright install chromium` once)

## Architecture rules (non-negotiable)
- `src/sim/` is pure TypeScript: no DOM, no Three.js imports. Deterministic given seed + inputs.
- `src/render/` and `src/ui/` only READ GameState; all mutations go through `sim.step()` or `sim.dispatch(action)`.
- One tick = one in-game minute. Never tie simulation to requestAnimationFrame delta.
- Every system in `src/sim/systems/` exports `step(state, ctx)`; order is defined in `src/sim/index.ts`.
- Every incident has: cause (string key), probability function, 2-3 player choices, consequences. See GDD section "Realistické problémy".
- Game numbers (prices, speeds, probabilities) live in `src/data/balance.ts`, never inline.
- All user-facing strings in `src/data/i18n/en.json`.

## Simulation conventions
- Money is integer cents everywhere in GameState (`eur(1600)` in balance.ts); cash only changes through `post()` in `src/sim/economy/ledger.ts`, so cash always equals starting cash + ledger.
- GameState is plain data (objects, arrays, Maps). Anything derived (navigation grid, per-tick time flags) lives in `SimContext` and is rebuilt on load. IDs come from `state.nextId`, randomness from `state.rng` via `src/sim/rng.ts`.
- No `Math.exp/log/pow/sin` in the sim: only arithmetic that is bit-identical across JS engines.
- Grid: cell (x, y) is a 1 m square, x along the hall width, y along its depth; in the 3D scene grid x → X and grid y → Z.
- Workers move several cells per tick; a tick's minute is split exactly between walking and work steps (`src/sim/systems/agents.ts`). To animate them, follow `worker.trail` (where they went during the last tick), not a straight line to `worker.pos`.
- Render and UI signatures take `GameView` (deep read-only `GameState`), never `GameState`.
- `sim.dispatch(action)` applies an action between ticks with the same context systems get (it can `post()` money and `emit()` events) and returns those events; a refused action changes nothing.
- A task is a list of steps; `walk` steps name a target (`loc`, `dock`, `station`, `vehicle`, `cell`) and the path is found when the step starts. Whatever a task claims (pallet, slot, units, vehicle) is reserved when it is planned.

## People and incidents
- Performance comes from `src/sim/people.ts` (`speedFactor`, `errorFactor`, `mispickChance`): stats, fatigue above the threshold and the training week. Never read `balance.worker.*ByStat` directly elsewhere.
- Incidents live in `src/sim/incidents/index.ts`: one exported probability function per cause, `raise…`/`maybe…` where the thing happens, and `resolve()` with every choice's consequences. The first choice is the do-nothing one and applies at the deadline. Random incidents are off in tests unless asked for (`createSim({ incidents: true })`).
- A pallet with `hold` set (lost, damaged) is skipped by pick planning; work an incident needs done at a pallet is an `attend` task.
- Someone dismissed or a temp whose time is up leaves only when they have no task (`worker.leaving`), so no task is ever cut short.

## Saving
- `src/save/serialize.ts` turns GameState into JSON and back (pure, tested); `src/save/storage.ts` is the IndexedDB slot. Bump `SAVE_VERSION` in `src/sim/state.ts` whenever the shape of GameState changes: `readState()` turns saves of another version away rather than loading them broken.

## Render conventions
- One layer per kind of thing in `src/render/` (`racks.ts`, `pallets.ts`, `workers.ts`, `trucks.ts`); `scene.ts` calls their `sync(state, …)` every frame. Anything drawn many times is an `InstancedMesh` (helpers in `instancing.ts`); models are merged from coloured boxes (`parts.ts`), colours come from `palette.ts`.
- The view runs one tick behind and animates between ticks: `main.ts` passes `alpha` (fraction of the next tick elapsed). Purely cosmetic motion the sim knows nothing about (trucks driving in and out) is advanced by `simSeconds`, which is 0 while paused.
- Pallets that are not in a location (on a truck bed, on a pallet jack) are placed through the shared `moving` map filled by the truck and worker layers.
- Maths that needs no Three.js goes in `motion.ts` and gets a Vitest test. In dev, `window.view.stats()` reports draw calls and triangles.

## UI conventions
- `src/ui/store.ts` holds the state of the interface itself (tool in hand, selection, open panel); it is not saved and the simulation never sees it. `src/ui/controller.ts` turns mouse and keyboard in the 3D view into selections and `sim.dispatch()` calls.
- Panels and cards are plain functions of `GameView`. Anything they need worked out (truck board, month to date, cash-flow projection, rack contents) is a pure query in `src/sim/queries.ts` with a Vitest test — not logic inside a component.
- A rule the player must be told about before acting (can a rack go here, how wide are the aisles) is computed by the simulation (`sim.previewRack`) and only drawn by render/UI, so the preview and the action can never disagree.
- Wording shared between components lives in `src/ui/text.ts`; every string goes through `t()` (typed keys) or `tData()` (keys built from data such as `sku.<id>`).
- What the player must notice is worked out, not stored: `alerts(state)`, `paceForecast(state)`, `dayTimeline(state)` and `bubbleOf(state, worker)` in `queries.ts` feed the alerts column, the timeline and the icons over workers. An alert disappears when its cause does. Things that *happened* (carrier left, penalty charged) are `Notice`s in the UI store, added in `main.ts` from sim events.
- `main.ts` `handle(events)` is the one place sim events turn into interface reactions (news, floating amounts via `ui/floaters.ts`, auto-pause); events from `sim.dispatch()` reach it through `controller.onEvents`.
- Clicking in the scene: `view.pick()` resolves what is under the cursor to an `EntityRef`; `view.setSelection()` outlines it.

## Workflow
- Write a Vitest test for every sim system before or with the implementation.
- Run `npm run test` and `npm run typecheck` before declaring a task done.
- Keep PRs scoped to one milestone from docs/GDD.md.
- Commit messages: `M<n>: <what>`.

## Performance budget
60 fps with 2000 pallet slots and 30 agents on integrated GPU. Use InstancedMesh for racks, pallets, boxes.
