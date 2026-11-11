# Making Warehouse Manager fun — plan

Status: the MVP from `docs/GDD.md` is complete (M0–M5). It works, but it is not yet a game one wants to keep playing. This document says why, and what to change, in an order where every step ends with something playable.

Read `CLAUDE.md` first: its architecture rules still apply to everything below.

## 1. What is wrong today

| Problem | Why it happens |
| --- | --- |
| Nothing to do after the first five minutes | Racks are placed once, then the planner runs the warehouse by itself. The player only reacts to an incident every few days. |
| Almost nothing to choose from | One rack type, one vehicle, one worker role, two fixed clients, a hall that is full after 20 racks, staff capped at three. |
| No reason to keep going | After the six onboarding tasks there are no goals, nothing to save up for, and phase 2 (bigger hall, forklifts) does not exist. |
| Hard to read | The player cannot see at a glance who is overloaded, where the bottleneck is, or what today's deadline pressure looks like. Problems arrive as short messages that vanish. |
| Looks unfinished | A grey plane around a grey box, flat light, box people, no sound, no feedback when something good happens. |

## 2. Principles for every change

1. **A decision, not a chore.** Each new thing must be a choice with a trade-off (money vs. time, space vs. speed, risk vs. margin). No clicking for its own sake.
2. **Real warehouses only.** Everything added exists in a real 3PL warehouse. If a warehouse worker would not recognise it, it does not go in.
3. **Pressure in waves.** Quiet mornings to plan, a rush before the 15:00 carrier, an evening to build. The day needs rhythm.
4. **Show, do not tell.** Every problem is visible in the hall before it becomes an incident (a queue at packing, a tired walk, a full receiving zone).
5. **Keep the rules of the codebase.** Game logic in `src/sim` with tests, numbers in `balance.ts`, strings in `en.json`, render and UI only read.

## 3. The plan at a glance

| Step | Theme | Player gets | Size |
| --- | --- | --- | --- |
| 1 | Clarity | Sees what is going on and why | small |
| 2 | Daily decisions | Something to decide every in-game hour | medium |
| 3 | More to build | Several kinds of storage, zones, equipment | medium |
| 4 | People | Hiring that matters, roles, breaks, training | medium |
| 5 | Goals and growth | Objectives, more clients, the move to a bigger hall | large |
| 6 | Look and sound | A place that looks alive, feedback for every action | medium, can run alongside any step |

Recommended order: 1 → 2 → 6 (first half) → 3 → 4 → 5 → 6 (rest). Steps 1 and 2 change the feel of the game most for the least work.

---

## Step 1 — Clarity

Goal: at any moment the player can answer "what is the bottleneck right now?" in three seconds.

**Day timeline (top of the screen, under the bar).** A strip from 00:00 to 24:00 with the shift, each truck's time window, the 12:00 order cutoff and the 15:00 carrier departure, and a marker for now. Trucks turn orange while waiting. This one element explains the whole day.

**State bubbles over workers.** A small icon above each person: carrying, picking, packing, idle (zzz), blocked (!), tired (above 70 % fatigue). Idle and blocked are what the player must notice.

**Overlays (key O cycles them).**
- *Pick heat*: floor cells coloured by how often they were walked today — shows whether the layout is good.
- *Slot fill*: racks coloured by SKU velocity class and how full they are.
- *Walking routes*: the current path of every worker as a line.

**Alerts column instead of vanishing messages.** A persistent list on the left: incidents, a truck waiting, orders at risk ("7 orders will miss 15:00 at the current pace"), receiving zone full, a worker idle for 30 minutes. Each entry focuses the camera on the cause. The "orders at risk" forecast is a new query: open due orders × average pick time vs. minutes left × staff on picking.

**Auto-pause options.** Pause on a new incident, on an offer, on a truck waiting 30 minutes (each can be switched off).

**Readable numbers.** Floating "+1.20 €" over the packing station when an order is packed, "−35 €" over a truck charged demurrage. Cash in the top bar flashes green or red when it changes.

Where: new queries in `src/sim/queries.ts` (forecast, heat counters kept in `DayStats`), `src/render/` overlay layer and bubbles, `src/ui/Timeline.tsx`, `src/ui/Alerts.tsx`.

Done when: a first-time player can say why an order was late without opening a panel.

---

## Step 2 — Daily decisions

Goal: a meaningful choice every in-game hour, each one a real 3PL situation. All of these are in the GDD ("Co hráč dělá během dne") but not built.

**Rush jobs.** Two or three times a day a client calls: "40 extra lines, must leave today, 2× the fee" or "a pallet order for the 15:00 truck, +80 €". Accept and risk the regular orders, or decline. Declining too often costs a little reputation; failing an accepted one costs a lot. This is the single most important addition.

**Order priorities.** The player can pin a client or an order to the top of the queue, or put a client on hold. Wholesale (40 € late penalty) vs. e-shop (6 €) becomes a real trade-off when time runs out.

**Truck slots.** The evening before, the player sees tomorrow's deliveries and can move a delivery window (free once, then a small fee), so two trucks do not collide. A late or early truck (random, announced an hour ahead) forces a re-plan.

**Shift calls.** Buttons with a cost: "overtime today" (+1 hour, paid 1.5×, morale −), "send someone home early" (saves fatigue, loses capacity), "break now" (15 minutes, fatigue −, nothing gets done). Breaks that never happen raise fatigue faster.

**Receiving check.** Per delivery: check every pallet (slow, catches short or damaged deliveries from the client → the "wrong delivery" incident from the GDD) or wave it through (fast, the problem surfaces later as lost goods).

**Evening planning phase.** The day ends at 15:30 with the report, then a short "tomorrow" screen: deliveries, expected orders, who is on shift, applicants, offers. The player sets duties and priorities for tomorrow, then presses "start day". Nights are skipped. This gives the day a clear rhythm and removes eight hours of nothing.

**Daily and weekly targets from clients.** "Ship 95 % on time this week: +150 € bonus." Shown in the Clients panel and on the timeline.

Where: `src/sim/systems/orders.ts` (rush jobs as orders with a flag and a bonus), a `priority` on orders and clients read by `planner.ts`, new actions in `actions.ts`, a night-skip in `main.ts` driven by a sim flag, new incident kind `wrong-delivery` in `src/sim/incidents`.

Done when: playing one day at 1× without touching anything gives a clearly worse result than playing it actively.

---

## Step 3 — More to build

Goal: the layout is a puzzle with several pieces, not one piece placed twenty times. Space in the garage must be tight enough that every choice costs something.

**Storage types** (all real, all with different trade-offs):

| Type | Holds | Good | Bad |
| --- | --- | --- | --- |
| Pallet rack (exists) | 3 pallets per level | dense, cheap | hand jack reaches level 1 only |
| Shelving for small goods | cartons of one SKU, 4 pick faces per metre | picking is 2× faster, no pallet in the way | must be replenished from a pallet (a new task) |
| Floor block stacking | 2 × 2 pallets of one SKU, stacked | free, good for wholesale | only the front pallet is reachable, mixed SKUs block each other |
| Cantilever / heavy bay | 2 heavy pallets | 1 500 kg | half the positions |

Shelving creates the classic **reserve vs. pick face** split and a **replenishment** task: this alone adds planning depth (which SKUs get a pick face?).

**Zones painted on the floor.** Receiving, dispatch and packing are fixed today; make them player-sized. More dispatch slots mean fewer racks. Add: returns area, damaged-goods corner, pallet-jack parking, break corner (morale +, takes 6 m²).

**Slotting by hand.** Paint an area "A items here / client X here". The fixed-positions strategy then respects it. This is the garage version of ABC zoning from the GDD and makes the pick-heat overlay actionable.

**Stations and equipment to buy.**
- Second packing table (packing becomes a visible queue otherwise).
- Check station: fewer wrong shipments, costs time per order.
- Second hand pallet jack (400 €); electric pallet jack (3 500 €, faster, needs charging overnight).
- Pick cart: one picker takes three orders in one walk (batch picking).
- Label printer / handheld scanner: the first step towards WMS — fewer mis-picks and lost pallets.
- Rack protectors, mirrors, floor markings: lower the damage chance.

**Move and rotate.** Empty racks can be moved for a fee instead of demolish and rebuild.

Where: rack `kind` on `Rack` and `Location` (`types.ts`), a replenishment task in `src/sim/tasks/`, zone actions in `actions.ts`, a catalogue file `src/data/buildings.ts`, new models in `src/render/racks.ts`, a categorised build menu in `src/ui/Toolbar.tsx`.

Done when: two players given the same garage build visibly different layouts and get different results.

---

## Step 4 — People

Goal: staff are the main lever and each person is somebody.

**A real labour market.** Applicants are generated daily (already so), but add: a pool that stays for a few days, a job advert that costs money and brings better people, agency temps available the same day at a premium, a trial week.

**Traits** on top of the four stats, each with an upside and a downside: *veteran* (no training week, wants more pay), *fast but sloppy*, *careful* (never damages, slower), *early bird / night owl* (matters once shifts exist), *team player* (morale + for others), *often ill*.

**Roles and qualifications.** Warehouseman, picker/packer, forklift licence (for step 5), shift lead (one per shift: the others work 10 % faster and incidents are flagged earlier). Training courses cost money and a day off.

**Wages and morale as decisions.** Give a raise, pay a bonus after a hard week, refuse — with visible effects. A worker with low morale warns before quitting.

**Breaks and shift length** set by the player (30/45/60 minutes, shift 8 or 10 hours) with the fatigue curve shown in the People panel.

**Skill growth.** People get better at what they do most (a picker's accuracy rises over weeks). This makes keeping staff worth more than replacing them.

Where: `src/sim/people.ts`, a traits table in `src/data/`, new actions, People panel.

Done when: the player hesitates before dismissing someone.

---

## Step 5 — Goals and growth

Goal: always something to work towards.

**Objectives ladder** (replaces the end of onboarding): "ship 100 orders", "a week above 95 % OTIF", "sign a second client", "save 10 000 € for the deposit". Each pays a small reward or unlocks something. Always three visible.

**More clients, more variety.** Six to eight client archetypes instead of two (fragile ceramics, bulky garden goods, seasonal toys with a December peak, a subscription box with a fixed monthly wave, a demanding electronics shop). Each changes what a good layout looks like.

**Contract negotiation.** Three sliders at signing — volume, SLA, price — with the client's acceptance depending on reputation. Tight SLA pays more and hurts more.

**The move to the small hall (GDD phase 2).** 1 200 m², two docks, forklift with battery and charger, aisle widths that finally matter, two shifts. This is the big milestone the garage builds towards; without it the game has no second act.

**Loan and leasing** (GDD finance): the way to afford the move earlier, with interest.

**Seasons and events.** A calendar with a pre-Christmas peak, a client promotion week, a carrier strike day, an inspection.

**Score.** Company value after 365 days, shown at the end of each month.

Where: `src/sim/systems/clients.ts`, a new `objectives` system, `src/data/clients.ts` and `skus.ts`, hall specs in `src/data/halls.ts`, new vehicle kinds in `balance.ts`.

Done when: a ten-hour save still has a next thing to reach for.

---

## Step 6 — Look and sound

Goal: "an architectural visualisation come alive" (GDD), not a grey box on a grey plane. Keep the palette from the GDD and the performance budget (60 fps, 2 000 pallets, 30 people).

**Surroundings** (the biggest visible win for the least work):
- A yard of worn asphalt with parking bays, lane markings and a turning circle; a kerb and a strip of grass; a road with occasional passing cars.
- A chain-link fence with a gate where trucks enter, lamp posts, a skip, stacked empty pallets, a few low-poly trees and neighbouring industrial units in the background.
- A sky gradient with a visible horizon instead of fog on grey.

**The building.** Sandwich-panel walls with a cut-away height that follows the camera, a roller door that opens when a truck docks, a staff door, windows, roof trusses shown faintly from below. Concrete floor with joints, tyre marks near the dock and painted walkways.

**Light.** A sun that moves through the day (warm low light in the morning, white at noon, orange before the shift ends), soft shadows, ambient occlusion in the corners (baked or SSAO), tone mapping. Interior strip lights that switch on at dusk. This alone makes screenshots look finished.

**Models.**
- People: proper low-poly figures with a walk cycle, a carrying pose and a pulling pose; helmet or cap; vest colour by role.
- Pallets: visible cartons with tape and a label, shrink wrap on wholesale pallets, three or four carton sizes per SKU family so the hall is not rows of identical boxes.
- Racks: beam labels with the address, upright protectors, load signs.
- Trucks: van, box truck and articulated lorry, client liveries, a tail lift that lowers, brake lights; trucks drive in on the road and reverse to the dock.
- Props: packing table with tape gun and boxes, a desk with a computer, bins, fire extinguishers, a first-aid box.

**Life.** A carton travels from the pick to the packing table and onto a growing cage of parcels in dispatch. Dust motes in the light. A forklift beacon later. People wave or stretch when idle.

**Juice.** Racks drop in with a small bounce when built, a puff of dust, a cash sound; packed orders pop a small "+€"; the carrier leaving on time gets a horn and a green tick over the dock.

**Sound** (GDD "Audio"): a quiet hall ambience (ventilation, distant radio), footsteps, pallet-jack wheels, tape gun, truck engine and reversing beeper, door roller, a clear but soft chime for incidents. Sound must carry information: the beeper means a truck is at the dock.

**Interface polish.** Icons for every tool and panel, a build menu with pictures and prices, tooltips everywhere with the *why* ("3 m aisle: fine for a pallet jack, too narrow for a forklift"), a minimap of the hall, consistent colour meaning (yellow = selected, orange = warning, red = problem, green = good).

Where: `src/render/hall.ts` (split into `environment.ts`, `building.ts`), `src/render/scene.ts` (light and post-processing), new `src/render/models/`, `src/audio/` (new, reads sim events only), `src/ui/` icons. Models: start with CC0 packs (Kenney, Quaternius) as the GDD suggests, loaded as glTF and instanced.

Done when: a screenshot of the garage at 14:45 could be posted without an apology.

---

## 4. Balance changes to make alongside

The current numbers make the game either idle or abruptly lost.

- **A lost client should not end the run in week one.** Soften the breach rule for the first month, or give a warning stage ("on notice") before leaving.
- **Sickness of the only worker** currently cascades into losing the client in most runs if ignored. Delay sickness until a second person is hired, or make "agency temp" the default choice.
- **Money has nothing to buy.** Once steps 3–5 exist, tune prices so there is always one affordable thing and one thing to save for.
- **The first hour needs a curve**: one client and few orders on day 1, the second client around day 3–5, the first rush job on day 2, the first incident no earlier than day 3.

The owner tunes final numbers by playing (GDD rule); these are the places to look.

## 5. How to work through this

One step per session, each ending in a playable build with tests green:

1. Read `CLAUDE.md`, `docs/GDD.md` and this file.
2. Pick the next step; write the sim part with Vitest tests first, then render and UI.
3. Run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`.
4. Play one in-game day in the browser and check the step's "Done when".
5. Commit as `F<step>: <what>` and update the status table below.

Suggested first prompt for the next session:

> Read CLAUDE.md, docs/GDD.md and docs/FUN-PLAN.md. Do Step 1 (Clarity) and Step 2 (Daily decisions) from FUN-PLAN.md. Start with the day timeline, the alerts column and rush jobs.

## 6. Status

| Step | Status |
| --- | --- |
| 1 Clarity | not started |
| 2 Daily decisions | not started |
| 3 More to build | not started |
| 4 People | not started |
| 5 Goals and growth | not started |
| 6 Look and sound | not started |

## 7. Questions for the owner

- **Night skip**: is ending the day at the report and jumping to the next morning acceptable, or should nights stay for a later night shift?
- **Models**: CC0 packs now (fast, generic), or custom low-poly models later (a few days of Blender work, distinctive)?
- **Scope of step 5**: build the small hall (phase 2) next, or first deepen the garage with steps 2–4?
- **Tone**: strictly sober, or a little warmth (names, small idle animations, a radio in the background)?
