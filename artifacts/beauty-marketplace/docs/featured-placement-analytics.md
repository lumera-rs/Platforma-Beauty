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