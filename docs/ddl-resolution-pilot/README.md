# Phase 5B-4 Task 2B-1 — READ-ONLY Pilot

## Rezime i granica ovlašćenja

Ovo je zaseban, **NON-AUTHORITATIVE** izveštaj Task #938, zamene za otkazani
Task #937. #937 ostaje CANCELLED. Pripremio: Replit Agent, 2026-09-16.
Dokumentacioni follow-up #940 ispravlja F2–F5 prema korisnikovom sažetku
nezavisne Claude Code revizije; puni review dokument nije dostavljen.
Nezavisna Claude Code revizija ove ispravke: **PENDING / NOT SATISFIED**.

Pilot obuhvata **11 DDL mapiranja**, iz svih osam startup owners, a ne svih
1.435 mapiranja. Svih 1.435 mapiranja i svih 110 dodatnih operacija ostaju
**UNRESOLVED**. Inventory ostaje osam owners i 1.459 occurrences.
Broj mapiranja nije broj SQL literala niti broj mogućih runtime izvršavanja:
pojedini literali imaju više DDL operacija, ponovljene occurrences ili dinamičke
identifikatore. Svaki odabrani fingerprint pregledan je sa svojim occurrences.

Dozvoljen rezultat je samo ovaj dokumentacioni paket. Nema promene crosswalka,
klasifikacione logike, postojećih dokaza, startup koda, migracija, konfiguracije
ili produkcije. Nije korišćena nijedna baza. Nema odobrenja za uklanjanje DDL-a,
novu migraciju, adoption, deploy ili proširenje pilota.

## Kompletan paket za reviziju

Čitati zajedno, ovim redosledom:

1. **Ovaj dokument** — svrha, granice, zajednička evidence ograničenja i pitanja.
2. [Business Growth](business-growth.md) — četiri kompleksna/raznovrsna DDL slučaja.
3. [Media, shipping, marketplace i referral](other-owners.md) — četiri slučaja.
4. [Booking, web push i education bundle](booking-push-bundle.md) — tri slučaja.
5. [Provere i očuvanje ulaza](verification.md) — audit DB granice, komande,
   rezultati, početni checksum-ovi i završno Git stanje.
6. [Matrica zavisnosti svih 11 mapiranja](dependency-matrix.md) — nezavisno
   izvedene očekivane veze, dokumentovano pokriće i dokumentaciona provera.

Osnovni izbor u tabeli ispod ostaje tačno 11 mapiranja. Dopunski fingerprint
u F3 je cross-reference identičnog SQL-a sa drugim `operationKind`, ne dvanaesti
izbor i ne promena klasifikacije. Istorijski testovi iz originalnog pilota
nisu ponovljeni u ovom follow-up-u. Novi rezultati su odvojeni u verification
dokumentu; stari tekstualni brojač nije dokaz potpunosti zavisnosti.

Pojedinačne preporuke u analitičkim dokumentima služe samo usmeravanju dalje
istrage. Nisu authoritative klasifikacija, nisu zaključak o produkcionoj
bezbednosti i ne odobravaju naredni zadatak.

### Tačan izbor i preporuke

| Mapping fingerprint | Slučaj | NON-AUTHORITATIVE preporuka |
|---|---|---|
| `5c20ce8572c9cb903aaa420f3a5af864b2fe045c1d05cbf22d5900a264b762ec` | Business Growth: user_role rename | Candidate for FUTURE_MIGRATION_REQUIRED review |
| `b45170d38b78bc84383956d840406a2348d086cef3b8dc51486b91a133a2d913` | Business Growth: pg_trgm | Candidate for FUTURE_MIGRATION_REQUIRED review |
| `2e8946224c0e6b335c01cf43293c3a9b5fd36468cf319a7b7ab27547060baae5` | Business Growth: index drop | Candidate for FUTURE_MIGRATION_REQUIRED review |
| `71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a` | Business Growth: bundle constraint validation | Candidate for FUTURE_MIGRATION_REQUIRED review |
| `7cfee093bb641c194587456e373508589806368a08b9cc7cec9f74f862498b7d` | Media: image_assets table | Insufficient evidence |
| `c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48` | Shipping: singleton unique index | Insufficient evidence |
| `aaf9e97329d1d6edc7b5ee7a933a16677766066a331139bf540521ed366955f4` | Marketplace: concurrent index | Insufficient evidence |
| `a570f58ac2bc80fb8a0ee829d4b2c1aa66953b680261069bbbade8d1020c4ff1` | Referral: tracking_started_at | Insufficient evidence |
| `129cb111342ead768c0787a5db0580c3cf9965d634827dc0960cf3d817a74b2b` | Booking command: scope unique index | Insufficient evidence |
| `73652e83d9b635b78ec2067dfc2a786decd9a7f279976fffe768eef1f63c0b20` | Web Push: expires_at column | Insufficient evidence |
| `be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3` | Education bundle: immutable trigger | Insufficient evidence |

Četiri preporuke za buduću migracionu istragu ne znače da migracija sigurno
treba da bude primenjena: potrebno je prvo utvrditi konkretan production delta,
a svi FM gate-ovi ne prolaze. Sedam preporuka Insufficient evidence ne poriču
prikazane statičke poddokaze. Nema preporuke za istorijsko povlačenje.

## Činjenice, pretpostavke i neispunjeni uslovi

**Demonstrirano:** lokalni izvorni kod, puni SQL literali, reference canonical
migracije, deklarisani redosled i kontrolne grane, checksum integritet,
statički inventory i ponašanje proverenih fake-client putanja.

**Nije demonstrirano:** stanje bilo koje baze, izvršena istorijska mutacija,
realna validnost indeksa/constraint-a, postojeći redovi, poslovna ispravnost
backfill-a, stvarni lock contention, izvršena kompenzacija, produkcioni
ledger/marker, prava operatora i preklapanje objavljenih revizija.

Sve produkciono zavisne kapije su **NOT SATISFIED**. Gde se prikazuje UNKNOWN,
to znači da zaključak nije dokazan; nikad podrazumevani prolaz. FAILED označava
konkretno neispunjen uslov ili pokazanu razliku, a ne neuspešnu produkcionu
operaciju. PASSED u source-only kapiji nije prolaz celog statusa.

Matrice u pojedinačnim analizama koriste numeraciju postojeće metodologije:
CB1–CB7 = CANONICAL_BASELINE, FM1–FM7 = FUTURE_MIGRATION_REQUIRED,
RH1–RH6 = RETIRED_HISTORICAL. Njihov autoritet je
`docs/additional-operations-evidence/DDL-RESOLUTION-METHODOLOGY.md:35-118`.
Nijedna matrica ne dodeljuje mapping status.

## Postojeći fresh-database dokazi

Pregled postojećih repository dokaza nije pronašao sačuvan, proverljiv rezultat
disposable PostgreSQL izvršavanja kojim bi se dokazala ekvivalencija ovih
mapiranja. Ovo je ograničenje pregledanog repozitorijuma, ne tvrdnja da se
takvo izvršavanje nikada nije dogodilo.

Postoji **izvorni kod testa**, ne rezultat izvršavanja:

- `scripts/src/migrations/migrations.integration.test.ts:24-33` zahteva
  eksplicitno odobren disposable DB režim.
- Isti fajl `:60-76` pravi i briše privremenu bazu; **nije pokrenut**.
- `:109-145` opisuje izvršavanje canonical tela i fresh apply/rerun.
- `:285-315` sadrži assertions za konkurentne runnere i transactional rollback.
- `:340-351` počinje fresh-versus-adopted fingerprint proveru.

Ti testovi ne mogu se računati kao PASSED samo zato što postoje u kodu.
Postojeći `docs/additional-operations-evidence/verification.json:96-109`
beleži statičke/mock provere i eksplicitno ograničava njihov dokazni domet.
Novi pilot nije pokretao integration testove niti kreirao bazu radi dopune.

Source-only dokaz transaction modela:
`scripts/src/migrations/runner.ts:74-99` koristi BEGIN, izvršavanje tela,
postconditions i COMMIT za transactional migracije, odnosno ROLLBACK na grešku.
`:218-259` obuhvata advisory lock i ledger lifecycle.
Canonical header `migration.sql:1-25` deklarativno propisuje PostgreSQL 16,
transactional mode i session postavke sa timeout vrednostima 0.
To se ne može poistovetiti sa owner-specifičnim kratkim timeout-ima,
autocommit izvršavanjem ili concurrent index modelom.

## Praktičnost metodologije

Metodologija je praktična kao fail-closed okvir za pregled pojedinačnog
mappinga: sprečava da prisustvo imena objekta, uspešan test ili marker bude
zamena za dokaz tranzicione ekvivalencije.

Za masovnu primenu potrebna su sledeća pojašnjenja **u budućoj nezavisnoj
reviziji; ovde se samo predlažu, postojeća metodologija se ne menja**:

1. **Razdvojiti poddokaze od celog gate-a.** Statička jednakost pojedine
   definicije nije fresh/existing transition dokaz. Za svaku kapiju treba
   navesti šta je PASSED lokalno, a šta ostaje UNKNOWN/NOT SATISFIED.
2. **Eksplicitno predstavljati occurrence i runtime expansion.** Fingerprint
   može nositi više mesta pojavljivanja; source ordinal nije dovoljan dokaz
   runtime redosleda petlje, ranog return-a ili dinamičkog imena. Lokator i
   ordinal preuzimati iz tačnog fingerprint occurrence zapisa, ne iz drugog
   pojavljivanja istog SQL teksta; identični tekstovi mogu imati različit kontekst.
3. **Zavisnosti modelovati kao pregledive veze.** Posebno razlikovati prerequisites,
   zajednički lock/transaction, data mutation, function replacement i marker.
   Spisak dodatnih operacija ne znači da su one time rešene.
4. **Razjasniti FM2/FM7 redosled odobrenja.** Metodologija traži immutable SQL
   plan, ID i checksum, a nezavisnu reviziju pre kreiranja migration fajla.
   Potrebno je razlikovati pregled predloga u dokumentu od autorizovanog
   migration artefakta. Ovaj pilot ne pravi ni SQL plan ni migraciju.
5. **Odvojiti dokaz nedostižnosti od marker opt-out-a.** Aktuelan marker može
   preskočiti granu na jednoj bazi; stariji/nedostajući marker, partial rollout
   i recovery ostaju podržani dok se drugačije ne dokaže.
6. **Definisati format nezavisnog production evidence paketa.** Identitet i
   vreme snimka, release scope, ledger, data invariants i restore dokaz moraju
   biti proverljivi. To je pitanje za reviziju, ne odobrenje pristupa.

Pilot nije statistički reprezentativan uzorak cele istorije i ne dozvoljava
ekstrapolaciju procenta bezbednih, nepotrebnih ili migraciono spremnih operacija.

## Pitanja za nezavisnu Claude Code reviziju

1. Da li je svaki puni fingerprint vezan za sve njegove source occurrences,
   bez preskakanja dinamičkih vrednosti i kontrolnih grana?
2. Da li canonical isečci obuhvataju stvarnu definiciju, uključujući
   constraints, predicates, bindings i funkcije, a ne samo isto ime?
3. Da li je svaka utvrđena tekstualna/semantička razlika pravilno odvojena
   od nedostajućeg runtime dokaza?
4. Da li su produkciono zavisni i independent-review gate-ovi dosledno
   NOT SATISFIED, čak i kada je statički poddokaz povoljan?
5. Da li predlozi za dalju istragu ostaju neautoritativni i nijedan ne
   implicira odobrenje uklanjanja ili migracije?
6. Da li su efekti brisanja, enum rename-a, trigger replacement-a, backfill-a,
   constraint validation-a i partial concurrent-index completion-a opisani
   bez neosnovanog obećanja retry/rollback bezbednosti?
7. Da li su navedeni dodatni-operation ID-jevi potpuni za odabrane putanje,
   uključujući zajedničke operativne i poslovne zavisnosti?
8. Da li audit test importova dovoljno dokazuje da izvršene provere nisu
   otvorile realnu bazu, i da li je razlika mock loga i realnog stanja jasna?
9. Da li se potvrđuje da su jedine autorske follow-up promene pod
   `docs/ddl-resolution-pilot/`, sa očuvanim canonical, source i evidence
   pinovima? Istorijski commit imao je šest putanja (pet dokumenata i metadata);
   njegov dokaz i broj follow-up putanja su odvojeni u verification dokumentu.

## Obavezno zaustavljanje

**STOP — čeka se nezavisna Claude Code revizija.**
Ne pokretati naredni zadatak, širiti uzorak, menjati mapping statuse ili
pristupati bazi kao nastavak ovog izveštaja. Nema GitHub push-a, Publish-a
ili Deploy-a.