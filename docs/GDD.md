# Warehouse Manager – GDD a zadání pro Claude Code

Nov 10, 2026 · @Matyáš

## Pitch

Warehouse Manager je 3D webový simulátor, ve kterém z pronajaté garáže vybuduješ distribuční centrum. Řídíš tok zboží, lidi a techniku; hra tě trestá za chaos a odměňuje za dobře navržený provoz. Nejde o reflexy, ale o rozhodnutí: kam dát regály, koho najmout, kterou zakázku odmítnout.

**Herní pilíře**

1. **Realismus provozu** – každý problém ve hře existuje i v reálném skladu (expirace, manko, zácpa na rampě, nemocenská). Hráč, který dělal ve skladu, musí říct „jo, přesně takhle to je“.
2. **Layout je gameplay** – uspořádání haly přímo určuje rychlost pickování, počet nehod a kapacitu. Špatný layout nejde zachránit penězi.
3. **Řetězové krize** – jeden malý problém (ještěrka bez baterky) spouští další (kamion čeká → pokuta → klient odejde). Hráč se učí předcházet, ne hasit.
4. **Čitelnost** – všechno, co se děje, je vidět ve 3D a vysvětlené v číslech. Žádné skryté RNG bez indikace.

**Reference**

| Hra | Co si bereme | Co ne |
| --- | --- | --- |
| Supermarket Simulator | smyčka naskladnit → prodat → rozšířit, uspokojení z plných regálů | první osoba, ruční nošení |
| Two Point Hospital | manažerský pohled, zaměstnanci s vlastnostmi, čitelné problémy | humor a karikatura |
| Factorio / Shapez | layout jako hlavní optimalizační hra | abstraktní automatizace |
| Transport Fever | kamiony, časová okna, logistika v měřítku | mapa města |
| Prison Architect | stavění zevnitř budovy, dění vidíš shora | tematika |

## Základní rozhodnutí

Rozhodnuto 10. 11. 2026: manažerský pohled, singleplayer, web. Vše ostatní v tomto dokumentu je návrh k diskuzi.

| Oblast | Rozhodnutí | Proč |
| --- | --- | --- |
| Pohled | Manažerský (volná kamera shora, izometrie 45°, zoom až na úroveň jedné palety) | Simulátor řízení, ne řízení ještěrky; nejlevnější na výrobu |
| Hráči | Singleplayer, lokální save + volitelný cloud save a leaderboard | Simulace je deterministická, multiplayer by násobil složitost |
| Platforma | Prohlížeč (desktop first, tablet později) | Tvůj stack, nulová distribuční bariéra |
| Engine | Three.js + TypeScript + Vite, bez herního frameworku | Plná kontrola, malý bundle, Claude Code to zná dobře |
| Backend | Supabase (auth, cloud save, leaderboard), Cloudflare Pages (hosting) | Dle tvého plánu; backend není potřeba pro MVP |
| Jazyk hry | Angličtina v UI, i18n od začátku (čeština jako druhý jazyk) | Globální publikum, překladové soubory jsou levé |
| Čas | Simulační tick, 1 herní den = cca 8 minut reálného času při 1x, rychlost 1x/3x/10x + pauza | Standard žánru, pauza nutná pro stavění |
| Monetizace | Zatím žádná; připravit itch.io / Steam (Electron wrap) jako pozdější cestu | Nejdřív hráči, pak peníze |

## Core loop

Jeden herní den: zboží přijede, uloží se, objednávky se vychystají a odjedou; večer dostaneš výplatní pásku a report. Mezi dny stavíš, najímáš a uzavíráš smlouvy.

**Tok zboží (každá paleta prochází těmito stavy)**

1. **Příjem** – kamion přijede v časovém okně na rampu, skladník vyloží palety, zkontroluje proti dodacímu listu (chybějící/poškozené kusy = reklamace).
2. **Naskladnění (put-away)** – paleta dostane lokaci (ulička-regál-patro-pozice). Bez WMS si ji skladník vybere sám a často špatně; s WMS ji hra přidělí podle obrátkovosti.
3. **Skladování** – zboží leží, stárne (expirace), může být poškozeno, ukradeno nebo „ztraceno“ (špatná lokace).
4. **Vychystání (picking)** – objednávka = seznam položek. Picker jde trasou po lokacích; délka trasy a počet chyb závisí na layoutu, WMS a únavě.
5. **Balení a kontrola** – balící stanice; kontrola snižuje chybovost, ale stojí čas.
6. **Expedice** – zásilka musí být na rampě do odjezdu dopravce. Zmeškání = čeká do dalšího svozu + pokuta za SLA.

**Co hráč dělá během dne**

- sleduje frontu kamionů a vytížení ramp
- přeřazuje lidi mezi úkoly (příjem / put-away / picking / balení)
- řeší incidenty (viz katalog níže)
- přijímá nebo odmítá ad-hoc zakázky s vysokou marží a krátkým termínem

**Co hráč dělá mezi dny (hra pozastavena)**

- staví a přestavuje layout (regály, rampy, zóny, nabíječky)
- najímá, propouští, školí, nastavuje směny
- kupuje a servisuje techniku
- vyjednává smlouvy s klienty (objem, SLA, cena za paletu/měsíc, cena za picking line)
- čte denní report: včasnost %, chybovost %, náklady na line, využití kapacity %

**Hlavní metriky, které vše řídí**

| Metrika | Co ovlivňuje | Typický cíl |
| --- | --- | --- |
| Včasnost expedice (OTIF %) | spokojenost klientů, pokuty | > 95 % |
| Chybovost pickingu (%) | vratky, reklamace, reputace | < 1 % |
| Náklady na vychystanou položku (€/line) | marže | klesá s progresí |
| Využití skladové kapacity (%) | příjem nových klientů | 75–90 % (nad 90 % roste chaos) |
| Cash | přežití | nikdy pod nulu déle než 14 dní |

## Herní systémy

Šest systémů, každý s vlastním stavem a vlastními problémy. Spolu tvoří simulaci; žádný nejde vypnout.

### 1. Zboží a lokace

- **SKU** má rozměr (kusy na paletu), hmotnost, obrátkovost (A/B/C), křehkost, teplotní režim (ambient / chlazené / mražené) a volitelnou expiraci.
- **Lokace** = adresa `U-R-P-X` (ulička, regál, patro, pozice). Každá má nosnost a typ (paletová, policová pro drobné zboží, podlahová bloková).
- **Strategie uskladnění** (odemyká se): náhodná (chaos) → fixní pozice → ABC zónování (rychloobrátkové u ramp) → slotting optimalizovaný WMS.
- **FIFO / FEFO** – bez WMS pickeri berou, co je nejblíž; expirované zboží = odpis + reklamace, pokud se expeduje.
- **Inventura** – skutečný stav se rozchází s evidovaným (špatné uložení, krádež, poškození). Pravidelná inventura stojí čas, ale bez ní rostou „neexistující“ objednávky.

### 2. Zaměstnanci

| Vlastnost | Rozsah | Co dělá |
| --- | --- | --- |
| Rychlost | 1–5 | tempo chůze a manipulace |
| Přesnost | 1–5 | chybovost pickingu, špatné uložení |
| Opatrnost | 1–5 | pravděpodobnost nehody, poškození zboží |
| Odolnost | 1–5 | jak rychle roste únava |
| Kvalifikace | žádná / průkaz VZV / vedoucí směny | co smí dělat |

- **Únava** roste během směny, přes 70 % padají všechny vlastnosti. Přestávky a délka směny jsou hráčovo nastavení.
- **Morálka** – mzda vs. trh, přesčasy, nehody, šatna/kuchyňka. Nízká morálka = výpovědi bez varování, vyšší nemocnost.
- **Role**: skladník, řidič VZV, picker, balič, vedoucí směny (zvyšuje výkon týmu, hlásí problémy dřív), agenturní brigádník (levný, nepřesný, k dispozici hned).
- **Směny**: ranní / odpolední / noční; noční stojí příplatek, ale kamiony v noci nemají frontu.
- **Zaučení**: nový člověk má první týden poloviční výkon a dvojnásobnou chybovost.

### 3. Technika

| Stroj | Cena (€) | Dosah | Omezení |
| --- | --- | --- | --- |
| Ruční paleťák | 400 | podlaha | pomalý, bez průkazu |
| Elektrický paleťák | 3 500 | podlaha | baterie |
| Čelní VZV (ještěrka) | 18 000 | 3 patra | průkaz, široké uličky (3,5 m) |
| Retrak | 32 000 | 6 pater | průkaz, úzké uličky (2,7 m) |
| Dopravníkový pás | 150/m | – | fixní trasa, ušetří chůzi |

- **Baterie** – kapacita na cca 6 h; nabíjení 8 h; bez nabíjecí stanice stroj stojí.
- **Servis** – každých 500 motohodin; vynechaný servis = exponenciálně rostoucí šance poruchy.
- **Leasing vs. nákup** – leasing šetří cash, ale je dražší celkem.

### 4. Dopravci a rampy

- Kamiony přijíždějí v **časových oknech** (např. 8:00–10:00). Přijetí mimo okno = čeká ve frontě; dlouhé čekání = dopravce účtuje stojné.
- Rampa obslouží jeden kamion; vykládka 33 palet trvá \~45 min s jedním člověkem a VZV.
- Typy: **příjem** (dodávky od klientů), **svoz** (balíková služba, pevný čas odjezdu), **celokamionová expedice** (FTL, objednává hráč).
- Dvůr má omezený počet stání; přeplněný dvůr blokuje příjezd.

### 5. Klienti a zakázky

- Hráč je **3PL sklad**: skladuje a expeduje cizí zboží. Příjmy = nájem za paletové místo/měsíc + poplatek za příjem palety + poplatek za vychystanou položku (line).
- **Smlouva** určuje objem (palet/týden), SLA (expedice do 24 h / do 4 h), pokutu za pozdní a chybnou zásilku, délku (3 / 6 / 12 měsíců).
- **Typy klientů**: e-shop (mnoho malých objednávek, špička před Vánocemi), velkoobchod (celé palety, předvídatelné), potraviny (chlazené, FEFO, přísné SLA), elektronika (vysoká hodnota, krádeže, pojistka).
- **Reputace** (0–100) – roste s OTIF, padá s reklamacemi. Určuje, jací klienti přijdou a za jakou cenu.
- Klient **odejde** po 3 porušeních SLA za měsíc nebo při vypršení smlouvy, pokud je reputace pod jeho prahem.

### 6. Finance

- **Příjmy**: měsíční fakturace klientům (platba se zpožděním 30 dní – cash-flow problém je záměrný).
- **Náklady**: mzdy (týdenně), nájem haly (měsíčně), energie (přímo úměrné chlazení a nabíjení), splátky leasingu, pojistka, odpisy zničeného zboží, pokuty.
- **Úvěr** – banka půjčí do výše 3× měsíčních tržeb, úrok roste s dluhem. Kontokorent kryje 14 dní záporného cashe, pak insolvence = game over.
- Hráč vidí **P&L za měsíc** a **cash-flow projekci na 30 dní**.

## Realistické problémy a události

Žádný incident není náhodný trest: každý má příčinu, kterou hráč mohl ovlivnit, a hra ji v notifikaci pojmenuje. Pravděpodobnost roste s podmínkami ve sloupci Příčina.

| Incident | Příčina (co zvyšuje šanci) | Dopad | Prevence / řešení |
| --- | --- | --- | --- |
| Zácpa na rampě | víc kamionů v okně než ramp, pomalá vykládka | stojné, zpožděný příjem, blokovaný dvůr | další rampa, rozložit okna, víc lidí na příjmu |
| Vybitá ještěrka | málo nabíječek, žádná rotační baterie | stroj stojí 8 h | náhradní baterie, nabíjení přes noc |
| Nehoda VZV | únava řidiče, nízká opatrnost, úzké uličky s čelním VZV, křížení s pěšími | zničené zboží, zranění (nemocenská 2–6 týdnů), kontrola BOZP | oddělené trasy, zrcadla, školení, přestávky |
| Zboží se „ztratilo“ | chaotické uskladnění bez WMS, nováčci | objednávka se nedá vychystat, hledání stojí hodiny | WMS, inventura, fixní lokace |
| Expirované zboží | FIFO se nedodržuje, pomalá obrátka | odpis, reklamace pokud odešlo klientovi | FEFO ve WMS, hlídání zboží do 30 dní expirace |
| Špatně vychystaná zásilka | nízká přesnost, únava, podobná SKU vedle sebe | vratka, pokuta, reputace | kontrolní stanice, skáner (WMS), slotting |
| Nemocenská / výpověď | nízká morálka, přesčasy, zima na hale | výpadek lidí, zaučování nových | rezerva lidí, agentura, lepší podmínky |
| Krádež | elektronika bez kamer, noční směna bez vedoucího | manko, ztráta důvěry klienta | kamery, uzamykatelná zóna, pojistka |
| Výpadek chlazení | stará jednotka bez servisu, přetížení | celá chladná zóna k odpisu během 6 h | záložní agregát, servis, alarm |
| Nedostatek palet | nevrácené EUR palety dopravci | nelze naskladnit ani expedovat | paletový účet, nákup rezervy |
| Kontrola BOZP / inspektorát | po nehodě, náhodně 1× za čtvrtletí | pokuta nebo uzavření uličky, dokud se neopraví | značení, hasicí přístroje, průkazy, revize regálů |
| Poškozený regál | náraz VZV, přetížení nosnosti | ulička zavřená, riziko pádu | nárazníky, revize, hlídání nosnosti |
| Sezónní špička | listopad–prosinec, e-shop klienti | 2–3× objem objednávek | brigádníci předem, noční směna, odmítnout nové klienty |
| Klient odchází | 3× porušené SLA, nízká reputace | ztráta příjmu, prázdné regály, které stále stojí nájem | sledovat SLA dashboard, odmítat, co nezvládneš |
| Požár | nabíjecí stanice vedle kartonu, žádné hasicí přístroje | ztráta zóny, pojistná událost, týden mimo provoz | sprinklery, oddělená nabíjárna |
| Nesprávná dodávka od klienta | náhodně, častěji u malých klientů | hráč musí rozhodnout: přijmout, odmítnout, reklamovat | kontrola na příjmu (stojí čas) |

**Jak se incidenty prezentují**: ikona nad místem ve 3D + záznam v panelu událostí s příčinou a dvěma až třemi tlačítky (např. „Poslat na servis“ / „Jet dál na riziko“). Hra nikdy nevyřeší incident sama.

## Progrese a ekonomika

Čtyři fáze; přechod mezi nimi není level-up, ale rozhodnutí hráče pronajmout větší halu. Každá fáze přináší nové typy klientů a s nimi nové problémy.

| Fáze | Hala | Lidí | Technika | Klienti | Nové problémy | Typická délka |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Garáž | 300 m², 1 rampa, 60 paletových míst | 1–3 | ruční paleťák | 1–2 malé e-shopy | únava, chybovost, ztracené zboží | 1–2 h hry |
| 2. Malá hala | 1 200 m², 2 rampy, 400 míst | 4–10 | VZV, nabíječka | velkoobchod, větší e-shop | zácpa na rampě, nehody, palety, smlouvy | 3–5 h |
| 3. Střední hala | 4 000 m², 4 rampy, 2 000 míst, chlazená zóna | 10–30 | retrak, dopravník, WMS | potraviny, elektronika | FEFO, krádeže, chlazení, BOZP, směny | 5–10 h |
| 4. Distribuční centrum | 12 000 m², 10 ramp, 8 000 míst | 30–100 | automatizace (dopravníkové třídění, AGV) | národní řetězce, sezónní špičky | cash-flow v měřítku, odbory, výpadky automatizace | otevřený konec |

**Startovní čísla (fáze 1, k vybalancování v prototypu)**

- Start: 15 000 € cash, nájem 900 €/měsíc, 1 skladník za 1 600 €/měsíc.
- První klient: 40 palet skladování × 8 €/měsíc + 1,20 € za line, cca 60 lines/den → \~2 500 €/měsíc.
- Cíl fáze 1: dva klienti, OTIF nad 90 %, 10 000 € na kauci za malou halu.

**Odemykání (tech tree bez stromu)**: věci se odemykají penězi a předpoklady, ne body. WMS vyžaduje vedoucího směny; retrak vyžaduje úzké uličky; chlazená zóna vyžaduje 3fázovou přípojku (jednorázový náklad). Hráč vždy vidí, co mu k čemu chybí.

**Konec hry**: žádný. Skóre pro leaderboard = hodnota firmy (cash + majetek + 12× měsíční zisk) po 365 herních dnech; dál sandbox.

## UI/UX a ovládání

Hlavní obrazovka je 3D hala; všechno řízení jde přes kliknutí na objekt ve scéně nebo přes čtyři panely. Žádné celoobrazovkové menu během hry.

**Kamera**: orbit kolem haly, zoom od celé haly po jednu paletu, WASD/okraj obrazovky posun, Q/E rotace o 90°, klávesa pro top-down 2D pohled při stavění.

**Stavění**: mřížka 1 × 1 m. Regál = 2,7 × 1,1 m blok s patry. Hra v reálném čase ukazuje při umístění: šířku uličky (červená pod 2,7 m, oranžová pod 3,5 m), dosah VZV, průchozí trasy. Přesun plného regálu není možný – nejdřív vystěhovat.

**Panely (klávesy 1–4)**

| Panel | Obsah |
| --- | --- |
| Provoz | fronta kamionů, otevřené objednávky s deadlinem, vytížení lidí, aktivní incidenty |
| Lidé | seznam, vlastnosti, únava, směna, mzda, přiřazení úkolů, nábor (3 náhodní kandidáti denně) |
| Klienti | smlouvy, SLA plnění za měsíc, nabídky nových klientů, reputace |
| Finance | cash, P&L, cash-flow 30 dní, úvěr, leasing |

**Horní lišta**: datum a čas, rychlost (pauza / 1x / 3x / 10x), cash, OTIF dne, počet incidentů. **Dolní lišta**: stavební nástroje (regály, zóny, technika, infrastruktura, demolice).

**Kliknutí na objekt ve scéně** otevře malý kontextový panel: zaměstnanec (co dělá, únava, přeřadit), regál (obsah po patrech, nosnost), paleta (SKU, klient, expirace, kdy přišla), kamion (dopravce, náklad, okno, čeká od), rampa (obsazenost dne).

**Onboarding**: žádný tutoriál-text. První den vede vedoucí směny (NPC) šesti úkoly: postav regál, přijmi kamion, naskladni, vychystej, expeduj, přečti report. Každý úkol se splní reálnou akcí.

## Vizuál a audio

Low-poly, čisté tvary, přirozené barvy průmyslového skladu; žádný neon, žádná karikatura. Cíl: vypadá jako architektonická vizualizace, která ožila.

- **Paleta**: beton šedá (#B8B5AE), ocel modrošedá (#5C6B78), oranžové regály (#E07B39, reálná barva paletových regálů), žlutá bezpečnostní (#F2C230) pro značení a VZV, teplé bílé světlo. Incidenty červeně (#D64545), pouze ikony.
- **Modely**: vlastní low-poly v Blenderu nebo Kenney/Quaternius CC0 sady (sklad, VZV, postavy) – pro MVP CC0, později vlastní. Lidé bez obličejů, barva vesty = role.
- **Světlo**: jedno směrové (denní), stíny jen od velkých objektů, ambient occlusion zapečený do textur. Noční směna = zářivky, které blikají při špatné údržbě (čistě vizuální signál).
- **Animace**: skeleton pro chůzi/zvednout/položit, VZV zvedá vidle; vše ostatní procedurálně (interpolace).
- **UI**: HTML/CSS overlay nad canvasem, bezpatkové písmo (Inter), tmavé poloprůhledné panely, čísla vždy s jednotkou.
- **Audio**: ambient haly (vent, pípání couvající VZV, kamion na dvoře), krátké zvuky událostí, žádná hudba ve výchozím stavu (volitelná lo-fi). Zvuk nese informaci: pípání VZV = ještěrka couvá v uličce s lidmi.

## Technická architektura

Simulace je oddělená od renderu: `sim/` je čistý TypeScript bez Three.js, deterministický, testovatelný v Node. Render jen čte stav. To je nejdůležitější architektonické pravidlo celého projektu.

**Stack**

| Vrstva | Volba | Poznámka |
| --- | --- | --- |
| Jazyk / build | TypeScript, Vite | strict mode, ESLint |
| 3D | Three.js (r17x), InstancedMesh pro regály a palety | tisíce palet = jedna draw call na typ |
| Pathfinding | vlastní A\* na mřížce 1 m + flow field pro VZV | lidé a stroje mají různé průchodnosti |
| UI | Preact nebo Svelte overlay nad canvasem | reaktivní panely, malý bundle |
| Stav | jeden `GameState` objekt, immutable update per tick není nutný – mutace uvnitř `sim/`, UI dostává snapshot | jednoduchost před čistotou |
| Save | JSON `GameState` do IndexedDB (autosave každý herní den), export/import souboru | cloud save přes Supabase později |
| Backend | Supabase: auth (anonymní + e-mail), tabulka `saves`, tabulka `leaderboard` | až po MVP |
| Hosting | Cloudflare Pages, GitHub Actions deploy | tvůj stávající postup |
| Testy | Vitest pro `sim/`, playwright smoke test pro UI | simulace musí mít testy od prvního dne |

**Simulační tick**

- 1 tick = 1 herní minuta. Při 1x rychlosti 3 ticky/s (den = 8 min), 3x a 10x jen násobí ticky na snímek.
- Pořadí v ticku: čas → příjezdy kamionů → generování objednávek → plánovač úkolů (přidělí volným lidem úkoly podle priority) → agenti (krok po trase, akce) → technika (baterie, opotřebení) → incidenty (vyhodnocení pravděpodobností) → finance (denní/měsíční uzávěrka) → události pro UI.
- Seedovaný RNG (`seed` v save) → stejný save + stejné vstupy = stejný výsledek. Nutné pro ladnění bugů a leaderboard.

**Datový model (jádro)**

```typescript
interface GameState {
  seed: number; tick: number; day: number;
  cash: number; reputation: number;
  hall: Hall;                 // rozměry, mřížka, rampy, zóny
  racks: Rack[];              // pozice, patra, nosnost
  locations: Map<LocId, Location>; // adresa -> obsah
  pallets: Map<PalletId, Pallet>;  // sku, client, qty, expiry, locId | 'in-transit'
  skus: Map<SkuId, Sku>;
  clients: Client[];          // smlouva, SLA, historie plnění
  orders: Order[];            // lines, deadline, status
  trucks: Truck[];            // okno, náklad, stav (en route/waiting/at-dock/done)
  workers: Worker[];          // vlastnosti, únava, morálka, směna, úkol, pozice
  vehicles: Vehicle[];        // typ, baterie, motohodiny, stav
  tasks: Task[];              // put-away / pick / unload / charge / repair
  incidents: Incident[];      // typ, příčina, možnosti, deadline
  ledger: LedgerEntry[];      // všechny pohyby peněz
}
```

**Struktura repozitáře**

```
src/
  sim/        čistá simulace (state, systems/, tasks/, incidents/, economy/)
  render/     Three.js scéna, instancing, kamera, picking objektů
  ui/         panely, HUD, stavební nástroje
  data/       SKU katalog, klienti, ceny, texty (i18n JSON)
  save/       serializace, IndexedDB, později Supabase
  main.ts     smyčka: sim.step() × N → render.sync(state) → ui.sync(state)
tests/        Vitest nad sim/
```

**Výkonnostní cíle**: 60 fps při 2 000 paletových místech a 30 agentech na integrované grafice; tick fáze 4 (8 000 míst, 100 agentů) pod 5 ms.

## MVP scope a milníky

MVP = fáze 1 (garáž) kompletní a hratelná hodinu, s pěti incidenty. Cíl: ověřit, že smyčka příjem → picking → expedice baví, než se staví hloubka.

**V MVP je**

- hala 300 m², mřížka, stavění a bourání regálů (1 typ), 1 rampa
- 1–3 zaměstnanci s vlastnostmi, únavou a jednou směnou; nábor a propuštění
- ruční paleťák, žádné baterie
- 2 klienti (e-shop, velkoobchod), 10 SKU, smlouvy s pevnými parametry
- kamiony příjem a svoz s časovými okny
- put-away bez WMS (chaos) a s fixními pozicemi
- incidenty: ztracené zboží, chybná zásilka, nemocenská, zácpa na rampě, poškozená paleta
- finance: cash, mzdy, nájem, pokuty, denní report, měsíční fakturace
- autosave do IndexedDB, rychlost 1x/3x/pauza
- onboarding šesti úkoly

**V MVP není**: VZV a baterie, více směn, chlazení, WMS, úvěr, leasing, BOZP, požár, krádeže, Supabase, zvuk, i18n (jen EN texty v JSON).

**Milníky** (odhad pro Claude Code s tebou jako vedoucím; každý končí něčím, co jde spustit)

| # | Milník | Hotovo, když | Odhad |
| --- | --- | --- | --- |
| M0 | Kostra | Vite + TS + Three.js, prázdná hala, kamera, mřížka, Vitest běží | 1 den |
| M1 | Simulace bez grafiky | `sim/` umí den: kamion → palety → lokace → objednávka → expedice; testy; výstup do konzole | 3 dny |
| M2 | Render stavu | regály, palety (instancing), lidé chodí po A\* trase, kamiony na rampě | 3 dny |
| M3 | Stavění a panely | umístění regálů s validací uliček, 4 panely, HUD, kontextové panely | 4 dny |
| M4 | Lidé a incidenty | vlastnosti, únava, nábor, 5 incidentů s volbami | 3 dny |
| M5 | Ekonomika a save | smlouvy, fakturace, report, autosave, onboarding | 3 dny |
| M6 | Playtest a balanc | 5 lidí hraje hodinu, čísla upravena, deploy na Cloudflare | 3 dny |

Celkem cca 20 pracovních dní na hratelné MVP. Fáze 2 (VZV, baterie, WMS, více ramp) je dalších \~15 dní.

## Zadání pro Claude Code

Založ repozitář `warehouse-manager`, vlož tento dokument jako `docs/GDD.md` a níže uvedený `CLAUDE.md` do kořene. Pak postupuj po milnících M0–M6, každý jako samostatná session, vždy s Opusem jako advisorem na architekturu `sim/`.

**CLAUDE.md (návrh)**

```markdown
# Warehouse Manager

3D web warehouse management simulator. Design doc: docs/GDD.md (source of truth for game rules and numbers).

## Stack
TypeScript strict, Vite, Three.js, Preact overlay UI, Vitest. No other game framework.

## Architecture rules (non-negotiable)
- `src/sim/` is pure TypeScript: no DOM, no Three.js imports. Deterministic given seed + inputs.
- `src/render/` and `src/ui/` only READ GameState; all mutations go through `sim.step()` or `sim.dispatch(action)`.
- One tick = one in-game minute. Never tie simulation to requestAnimationFrame delta.
- Every system in `src/sim/systems/` exports `step(state, ctx)`; order is defined in `src/sim/index.ts`.
- Every incident has: cause (string key), probability function, 2-3 player choices, consequences. See GDD section "Realistické problémy".
- Game numbers (prices, speeds, probabilities) live in `src/data/balance.ts`, never inline.
- All user-facing strings in `src/data/i18n/en.json`.

## Workflow
- Write a Vitest test for every sim system before or with the implementation.
- Run `npm run test` and `npm run typecheck` before declaring a task done.
- Keep PRs scoped to one milestone from docs/GDD.md.
- Commit messages: `M<n>: <what>`.

## Performance budget
60 fps with 2000 pallet slots and 30 agents on integrated GPU. Use InstancedMesh for racks, pallets, boxes.
```

**První prompt (M0 + M1)**

```markdown
Read docs/GDD.md and CLAUDE.md. Set up the project (M0): Vite + TypeScript strict + Three.js + Preact + Vitest,
ESLint, npm scripts dev/build/test/typecheck. Render an empty 300 m² hall (30×10 m) with a 1 m grid,
orbit camera with zoom limits, and a HUD showing day/time/speed/cash.

Then M1: implement src/sim/ for phase 1 without any rendering. Required: GameState per GDD data model,
seeded RNG, tick loop, truck arrival with time windows, unloading task, put-away with "chaos" strategy,
order generation for 2 clients, picking with A* on the grid, dispatch at carrier departure, daily report
(OTIF, error rate, cost per line). Write Vitest tests that run 3 in-game days headless and assert OTIF > 0
and cash changes match the ledger. Print the daily report to console. Do not touch render/ or ui/ beyond M0.
```

**Pořadí práce a pravidla pro sessions**

1. Každá session začíná „Read CLAUDE.md and docs/GDD.md, then continue milestone M\<n>“.
2. Před M2 nech Opuse zkontrolovat `sim/` API – render se na něj navěsí a předělávat ho později je drahé.
3. Balanc čísel (M6) dělej ty ručně v `balance.ts` podle hraní, ne Claude podle odhadu.
4. Každý milník = tag v gitu + build na Cloudflare Pages preview, ať máš co ukazovat.
5. Po M6 aktualizuj tento GDD podle toho, co se ve hře změnilo, až pak fáze 2.

## Otevřené otázky

- [ ] Název: „Warehouse Manager“ je obsazený generický termín (hledání, Steam). Alternativy k zvážení: „Dock & Stock“, „Pallet Empire“, „3PL Tycoon“, „Logistics Inc.“
- [ ] Měna ve hře: € (navrženo) vs. $ vs. neutrální „credits“
- [ ] Má být hra plně pauzovatelná během dne (jako Two Point), nebo jen mezi dny (tvrdší simulátor)?
- [ ] Modely: začít s CC0 sadou, nebo si nechat udělat vlastní low-poly (Blender, pár dní práce)?
- [ ] Fáze 4 automatizace (AGV, třídička): chceme ji vůbec, nebo končíme u střední haly a jít do hloubky?
- [ ] Leaderboard: podle hodnoty firmy po 365 dnech, nebo týdenní výzvy s pevným seedem (stejný sklad pro všechny)?
- [ ] Tablet: má být dotykové ovládání cílem od začátku, nebo až po MVP?
