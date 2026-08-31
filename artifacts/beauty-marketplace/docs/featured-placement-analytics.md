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

## Periodični poslovni pregled

Pre pokretanja pregleda izabrati eksplicitan UTC period (`period_start` je uključen, a `period_end` nije). Pregled vraća samo dozvoljene agregatne dimenzije, brojeve događaja i stope. Ne vraća identifikatore događaja, sesija, korisnika, salona, plasmana niti payment reference vrednosti.

```sql
SELECT
  placement_kind,
  placement_scope,
  countIf(event_name = 'featured_placement_requested') AS requests,
  countIf(event_name = 'featured_placement_qr_viewed') AS qr_views,
  countIf(event_name = 'featured_placement_paid') AS confirmed_payments,
  round(if(requests = 0, 0, qr_views * 100.0 / requests), 1) AS qr_per_request_pct,
  round(if(requests = 0, 0, confirmed_payments * 100.0 / requests), 1) AS payment_per_request_pct
FROM (
  SELECT
    we.event_id,
    we.event_name,
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
  WHERE we.event_type = 2
    AND we.event_name IN (
      'featured_placement_requested',
      'featured_placement_qr_viewed',
      'featured_placement_paid'
    )
    AND we.created_at >= toDateTime('{period_start}', 'UTC')
    AND we.created_at < toDateTime('{period_end}', 'UTC')
    AND ed.created_at >= toDateTime('{period_start}', 'UTC')
    AND ed.created_at < toDateTime('{period_end}', 'UTC')
  GROUP BY we.event_id, we.event_name
  HAVING placement_kind IN (
    'featured_salon',
    'featured_center',
    'special_offer'
  )
    AND placement_scope IN ('home', 'category', 'subcategory')
)
GROUP BY placement_kind, placement_scope
ORDER BY placement_kind, placement_scope
LIMIT 20
```

`event_id` se koristi isključivo unutar agregatnog upita da spoji dve dozvoljene dimenzije istog događaja. Ne sme se dodati u spoljašnji `SELECT`, zapisati u izveštaj ili prikazati timu.

### Obavezne oznake u izveštaju

| Kolona | Oznaka i tumačenje |
| --- | --- |
| `requests` | Uspešno kreirani zahtevi |
| `qr_views` | **Prikazi QR instrukcija** — broj prikaza, nije broj jedinstvenih zahteva |
| `confirmed_payments` | **Serverski potvrđene uplate** — samo potvrde koje su aktivirale plasman |
| `qr_per_request_pct` | `qr_views / requests × 100`; dijagnostička stopa angažovanja |
| `payment_per_request_pct` | `confirmed_payments / requests × 100`; konačna stopa konverzije |

Ako izabrani period nema redova, izveštaj treba jasno da prikaže „Nema zabeleženih događaja u izabranom periodu”, a ne da izmisli redove sa nulama za kombinacije koje se nisu pojavile. Uz period navesti da Replit Analytics obuhvata samo aktivnost prikupljenu nakon uključivanja analitike i objavljivanja ili ponovnog objavljivanja aplikacije.
