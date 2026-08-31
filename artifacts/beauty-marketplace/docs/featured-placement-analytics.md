# Funnel plaćenih isticanja

Replit Analytics meri funnel plaćenih plasmana kroz sledeće privacy-safe custom događaje:

| Korak | Event name | Kada se beleži |
| --- | --- | --- |
| Zahtev je kreiran | `featured_placement_requested` | Tek nakon uspešnog odgovora servera na kreiranje zahteva |
| QR instrukcije su prikazane | `featured_placement_qr_viewed` | Kada važeći QR za zahtev na čekanju stvarno postane dostupan u prikazu; najviše jednom po plasmanu tokom jednog montiranja stranice |
| Uplata je potvrđena | `featured_placement_paid` | Tek kada server potvrdi da je baš taj poziv promenio stanje zahteva iz `pending_payment` u `active`; uspešan idempotentni ponovni poziv ne pravi novi događaj |

Svaki događaj ima samo ove dimenzije:

- `placement_kind`: `featured_salon`, `featured_center` ili `special_offer`
- `placement_scope`: `home`, `category` ili `subcategory`

Ne šalju se naziv salona ili centra, naziv kursa, ID korisnika ili poslovnog subjekta, ID plasmana, payment reference, sadržaj IPS QR koda niti drugi podaci koji mogu identifikovati korisnika ili uplatu.

## Preporučeni funnel izveštaj

Za izabrani period i isti par `placement_kind` + `placement_scope`, pratiti:

1. `featured_placement_requested`
2. `featured_placement_qr_viewed`
3. `featured_placement_paid`

Odnos `qr_viewed / requested` pokazuje koliko uspešno kreiranih zahteva je stiglo do prikaza važećih instrukcija. Odnos `paid / requested` je konačna stopa potvrđene uplate. Treći korak koristi serverski potvrđenu tranziciju, pa neuspele, odbijene ili ponovljene idempotentne potvrde ne ulaze u metriku.

Broj `qr_viewed` predstavlja prikaze, a ne jedinstvene zahteve kroz sve sesije: ponovno otvaranje stranice u novoj sesiji može napraviti novi prikaz istog QR-a. Zbog toga se za stopu završetka kao imenilac koristi `requested`, dok je QR korak dijagnostički signal angažovanja.

## Periodični poslovni pregled i rano upozorenje

Pre pokretanja pregleda izabrati eksplicitan UTC period (`period_start` je uključen, a `period_end` nije). Prethodni period se završava tačno na `period_start` i ima isto trajanje kao izabrani period. Na primer, za izabrani period od 8. do 15. avgusta prethodni period je od 1. do 8. avgusta, sa istom poluotvorenom granicom `[početak, kraj)`.

Za upozorenja koristiti dva eksplicitna parametra:

- `minimum_requests`: najmanji dozvoljeni broj zahteva **u svakom od dva perioda**; preporučena početna vrednost je `30`
- `material_drop_pp`: najmanji apsolutni pad stope u procentnim poenima; preporučena početna vrednost je `10.0`

Pragovi su poslovna konfiguracija i moraju biti navedeni uz svaki izveštaj. Upozorenje se prikazuje samo kada izabrani i prethodni period oba imaju najmanje `minimum_requests` za isti par `placement_kind` + `placement_scope`. Tako mala ili nova grupa ne može da proizvede upozorenje na osnovu nestabilnog uzorka.

Pregled vraća samo dozvoljene agregatne dimenzije, brojeve događaja, stope, razlike i oznake upozorenja. Ne vraća identifikatore događaja, sesija, korisnika, salona, plasmana niti payment reference vrednosti.

```sql
WITH
  toDateTime('{period_start}', 'UTC') AS current_start,
  toDateTime('{period_end}', 'UTC') AS current_end,
  dateDiff('second', current_start, current_end) AS period_seconds,
  subtractSeconds(current_start, period_seconds) AS previous_start,
  toUInt64({minimum_requests}) AS minimum_requests_threshold,
  toFloat64({material_drop_pp}) AS material_drop_threshold_pp
SELECT
  placement_kind,
  placement_scope,
  current_requests,
  current_qr_views,
  current_confirmed_payments,
  current_qr_per_request_pct,
  current_payment_per_request_pct,
  previous_requests,
  previous_qr_views,
  previous_confirmed_payments,
  previous_qr_per_request_pct,
  previous_payment_per_request_pct,
  round(current_qr_per_request_pct - previous_qr_per_request_pct, 1) AS qr_change_pp,
  round(
    current_payment_per_request_pct - previous_payment_per_request_pct,
    1
  ) AS payment_change_pp,
  minimum_requests_threshold AS warning_minimum_requests,
  material_drop_threshold_pp AS warning_material_drop_pp,
  current_requests >= minimum_requests_threshold
    AND previous_requests >= minimum_requests_threshold AS warning_sample_sufficient,
  warning_sample_sufficient
    AND previous_qr_per_request_pct - current_qr_per_request_pct
      >= material_drop_threshold_pp AS qr_drop_warning,
  warning_sample_sufficient
    AND previous_payment_per_request_pct - current_payment_per_request_pct
      >= material_drop_threshold_pp AS payment_drop_warning
FROM (
  SELECT
    placement_kind,
    placement_scope,
    countIf(event_name = 'featured_placement_requested' AND is_current) AS current_requests,
    countIf(event_name = 'featured_placement_qr_viewed' AND is_current) AS current_qr_views,
    countIf(event_name = 'featured_placement_paid' AND is_current) AS current_confirmed_payments,
    round(current_qr_views * 100.0 / nullIf(current_requests, 0), 1)
      AS current_qr_per_request_pct,
    round(current_confirmed_payments * 100.0 / nullIf(current_requests, 0), 1)
      AS current_payment_per_request_pct,
    countIf(event_name = 'featured_placement_requested' AND NOT is_current)
      AS previous_requests,
    countIf(event_name = 'featured_placement_qr_viewed' AND NOT is_current)
      AS previous_qr_views,
    countIf(event_name = 'featured_placement_paid' AND NOT is_current)
      AS previous_confirmed_payments,
    round(previous_qr_views * 100.0 / nullIf(previous_requests, 0), 1)
      AS previous_qr_per_request_pct,
    round(previous_confirmed_payments * 100.0 / nullIf(previous_requests, 0), 1)
      AS previous_payment_per_request_pct
  FROM (
    SELECT
      we.event_name,
      we.created_at >= current_start AS is_current,
      maxIf(
        ed.string_value,
        ed.data_key = 'placement_kind' AND ed.data_type = 1
      ) AS placement_kind,
      maxIf(
        ed.string_value,
        ed.data_key = 'placement_scope' AND ed.data_type = 1
      ) AS placement_scope
    FROM website_event AS we
    INNER JOIN event_data AS ed ON ed.event_id = we.event_id
    WHERE period_seconds > 0
      AND we.event_type = 2
      AND we.event_name IN (
        'featured_placement_requested',
        'featured_placement_qr_viewed',
        'featured_placement_paid'
      )
      AND we.created_at >= previous_start
      AND we.created_at < current_end
      AND ed.created_at >= previous_start
      AND ed.created_at < current_end
    GROUP BY we.event_id, we.event_name, we.created_at
    HAVING placement_kind IN (
      'featured_salon',
      'featured_center',
      'special_offer'
    )
      AND placement_scope IN ('home', 'category', 'subcategory')
  )
  GROUP BY placement_kind, placement_scope
  HAVING countIf(is_current) > 0
)
ORDER BY placement_kind, placement_scope
LIMIT 20
```

`event_id` se koristi isključivo unutar agregatnog upita da spoji dve dozvoljene dimenzije istog događaja. Ne sme se dodati u spoljašnji `SELECT`, zapisati u izveštaj ili prikazati timu. Upit ne bira niti obrađuje ID korisnika, salona, plasmana, zahteva ili uplate, niti payment reference vrednost.

`period_end` mora biti posle `period_start`, `minimum_requests` mora biti pozitivan ceo broj, a `material_drop_pp` pozitivan broj. Te vrednosti treba validirati pre pokretanja upita; uslov `period_seconds > 0` je samo dodatna zaštita.

### Obavezne oznake u izveštaju

| Kolona | Oznaka i tumačenje |
| --- | --- |
| `current_*` | Broj ili stopa za izabrani period. QR je broj prikaza, ne broj jedinstvenih zahteva; uplate su samo serverski potvrđene aktivacije plasmana. |
| `previous_*` | Ista metrika za neposredno prethodni period iste dužine i isti `placement_kind` + `placement_scope`. |
| `qr_change_pp` | Promena `qr_views / requests × 100` u procentnim poenima; negativna vrednost označava pad. |
| `payment_change_pp` | Promena `confirmed_payments / requests × 100` u procentnim poenima; negativna vrednost označava pad. |
| `warning_minimum_requests` | Minimalni broj zahteva potreban u svakom periodu; obavezno prikazati uz rezultat. |
| `warning_material_drop_pp` | Prag materijalnog pada u procentnim poenima; obavezno prikazati uz rezultat. |
| `warning_sample_sufficient` | `true` samo kada oba perioda zadovoljavaju minimalni uzorak. |
| `qr_drop_warning` | **Materijalan pad QR/zahtev** — prikazati jasno upozorenje samo kada je uzorak dovoljan i pad dostiže prag. |
| `payment_drop_warning` | **Materijalan pad uplata/zahtev** — prikazati jasno upozorenje samo kada je uzorak dovoljan i pad dostiže prag. |

Kada je `warning_sample_sufficient = false`, ne prikazivati upozorenje o padu. Umesto toga prikazati neutralnu oznaku: „Nema upozorenja — uzorak je manji od 30 zahteva u najmanje jednom periodu”, pri čemu se broj `30` zamenjuje stvarnom vrednošću `warning_minimum_requests`.

Kada je odgovarajuća stopa prethodnog perioda `NULL` zbog nula zahteva, promena i upozorenje ostaju `NULL`/`false` i tretiraju se kao nedovoljan uzorak, a ne kao pad od nule. Pad se meri apsolutno u procentnim poenima, ne kao relativni procenat promene.

Ako izabrani period nema redova, izveštaj treba jasno da prikaže „Nema zabeleženih događaja u izabranom periodu”, a ne da izmisli redove sa nulama za kombinacije koje se nisu pojavile. Uz period navesti da Replit Analytics obuhvata samo aktivnost prikupljenu nakon uključivanja analitike i objavljivanja ili ponovnog objavljivanja aplikacije.
