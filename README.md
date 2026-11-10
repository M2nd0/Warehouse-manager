# Warehouse Manager

A 3D web simulator in which you grow a rented garage into a distribution centre.
Design document: [docs/GDD.md](docs/GDD.md). Working rules for the codebase: [CLAUDE.md](CLAUDE.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (add ?seed=42 for a fixed game)
npm run sim -- 30  # 30 in-game days headless, daily reports in the console
npm run test
```

## Layout

```
src/sim/     pure, deterministic simulation (no DOM, no Three.js)
src/data/    balance numbers, SKU and client catalogues, hall layouts, i18n
src/render/  Three.js scene — reads GameState only
src/ui/      Preact overlay — reads GameState only
src/save/    GameState ⇄ JSON
tests/       Vitest, runs the simulation headless
```

## Status

- **M0** – project skeleton, empty 30 × 10 m hall, orbit camera, HUD
- **M1** – phase 1 simulation without graphics: trucks → pallets → locations → orders → dispatch, daily report
