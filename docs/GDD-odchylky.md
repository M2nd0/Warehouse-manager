# Odchylky od GDD a odhadnutá čísla (stav po M5)

Podklad pro aktualizaci `docs/GDD.md` po playtestu (GDD, „Pořadí práce“, bod 5). GDD samotné jsem neměnil.

## Kde se hra chová jinak, než GDD říká

| Téma | GDD | Ve hře | Proč |
| --- | --- | --- | --- |
| Rychlost chůze | realistické časy (33 palet za ~45 min) | 5 m za herní minutu (reálně ~80) | Při ticku 1 min a mřížce 1 m by reálná rychlost znamenala, že každá cesta trvá méně než tick a layout by nehrál roli (pilíř 2). Manipulační časy jsou realistické. |
| SLA „do 24 h“ | expedice do 24 h | termín = odjezd svozu v 15:00; objednávka do 12:00 jede týž den, pozdější druhý den | S jedním svozem denně by objednávka z 14:55 měla nesplnitelný termín. |
| Odchod klienta | 3 porušení SLA za měsíc | 3 *dny*, kdy je pozdě/špatně přes 20 % objednávek klienta | Po objednávkách by klient odešel druhý den. |
| Incidenty | „hra nikdy nevyřeší incident sama“ | po lhůtě se uplatní první volba („nedělat nic“) | Datový model GDD má u incidentu deadline; bez něj by se neřešené hromadily. |
| Chybná zásilka | pokuta | incident s volbami (zaplatit / náhrada / rozporovat) | Je to jeden z pěti incidentů MVP. |
| Start hry | 1 skladník, první klient | prázdná hala, pauza, jen e-shop; velkoobchod pošle nabídku od 3. dne | Odpovídá onboardingu („postav regál“) a cíli fáze 1 (dva klienti). |
| Fakturace | měsíčně, splatnost 30 dní | faktura poslední den měsíce (měsíc = 30 dní), platba 30 dní poté | Kalendář je zjednodušený: 30denní měsíce, 7denní týdny, bez víkendů. |
| Nájem | měsíčně | předem, první den měsíce | — |
| Zácpa na rampě | plný dvůr blokuje příjezd | dvůr nemá kapacitu; incident vznikne po 45 min čekání | Kapacita dvora zatím není modelovaná. |
| Ztracené zboží | evidovaný vs. skutečný stav | paleta je „zatoulaná“: fyzicky na místě, ale nejde z ní vychystat, dokud se nenajde | Jednodušší model se stejným dopadem na hráče; plná inventura přijde s WMS. |
| Směny, přestávky | hráčovo nastavení | jedna pevná směna 07:00–15:30, bez přestávek | MVP má jednu směnu; přestávky nejsou. |
| Role | skladník, picker, balič… | jeden typ zaměstnance se „službou“ (vše / příjem / picking) + agenturní brigádník | MVP má 1–3 lidi. |
| Three.js | r17x | r187 | Aktuální verze v době založení projektu. |

## Čísla, která GDD neuvádí (můj odhad v `src/data/balance.ts`)

- **Stavba**: regál 150 €, při bourání se vrací polovina.
- **Smlouvy**: poplatek za příjem palety 4 €; velkoobchod 7 €/paleta/měsíc a 4,50 €/line; pokuty e-shop 6 € pozdě / 12 € chyba, velkoobchod 40 € / 60 €.
- **Poptávka**: e-shop 32 objednávek denně (≈ 60 lines), velkoobchod 1,5 objednávky denně; závozy 3–6 palet.
- **Kamiony**: stojné 35 € za započatou hodinu po 2 hodinách na místě; svoz 14:30–15:00.
- **Manipulace**: vykládka 2 min/paleta, zvednutí i položení 0,5 min, řádek pickingu 0,6 min + 0,15 min/kus, balení 1,5 min + 0,4 min/řádek.
- **Lidé**: únava 0,14 bodu za minutu práce (odolnost 3), nad 70 % až −40 % rychlosti a 2,5× chybovost; mzda 1 000 € + 50 € za bod vlastností; morálka a nemocnost (1,2 % denně při morálce 70).
- **Incidenty**: všechny pravděpodobnosti, ceny voleb a lhůty (sekce `incidents`).
- **Klienti**: nabídka od 3. dne při reputaci ≥ 40, platí 3 dny; po odchodu se klient vrací nejdřív za 30 dní.

## Co ukázaly headless běhy (60 dní, hotový layout, jen e-shop, 8 seedů)

- Když se na každou nemocenskou vezme brigádník: žádný den s porušeným SLA, žádný odchod klienta.
- Když se nemocenská jediného skladníka nechá být: i dvoudenní nemoc udělá 3–4 špatné dny po sobě (resty se vlečou) a klient odchází. Stalo se v 5 z 8 seedů, jednou už pátý den hry.

To je řetězová krize přesně podle pilíře 3, ale pro nového hráče může být příliš tvrdá. Hra na každý den s porušeným SLA upozorní („1 ze 3“). Kandidáti na ladění: `clients.breachShare`, `clients.breachDaysToLeave`, `incidents.sickChancePerDay`, nebo nemocenskou v prvním týdnu vypnout.

## Co z MVP chybí nebo je jinak

- **Put-away s fixními pozicemi** (MVP: „bez WMS (chaos) a s fixními pozicemi“) není; je jen chaos.
- **Game over** při záporném cashi (14 dní kontokorentu) není; cash může být záporný bez následků.
- **Vyjednávání smluv** není, parametry jsou pevné (odpovídá MVP).
- **Zvuk, i18n mimo EN, Supabase** nejsou (MVP je nechce).
- **Skóre / leaderboard** není.
