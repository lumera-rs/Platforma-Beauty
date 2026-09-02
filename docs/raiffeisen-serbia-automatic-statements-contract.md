# Raiffeisen Srbija — provera ugovora za automatske izvode

Datum provere: 2. septembar 2026.

## Zaključak

Zvanična, javno dostupna dokumentacija za konkretan proizvod Raiffeisen banke a.d. Beograd nije dovoljna za bezbednu implementaciju automatskog preuzimanja izvoda.

Zbog toga:

- Raiffeisen API adapter nije implementiran;
- automatski sync nije izložen u administratorskom interfejsu;
- izbor `raiffeisen_open_banking` server odbija dok ugovor ne bude potvrđen;
- nikakvi bankarski kredencijali nisu dodati u aplikaciju ili bazu;
- postojeći ručni CAMT.053 tok i dalje obrađuje XML samo u memoriji zahteva i ne čuva sirovi izvod.

## Provereni zvanični izvori

1. [Raiffeisen banka Srbija — međunarodno poslovanje i Cash Management](https://www.raiffeisenbank.rs/sr/privreda/medjunarodno-poslovanje.html)
   - Stranica potvrđuje da postoje H2H, EBICS, SWIFT FileAct i API veze uz ISO 20022 formate.
   - Ne navodi konkretan proizvod/ugovor, auth grant, token endpoint, statement endpoint, scope-ove, paginaciju, dozvoljeni vremenski opseg niti stabilni ID transakcije.
2. [Raiffeisen banka Srbija — iPortal](https://infoportal.raiffeisenbank.rs/)
   - Portal potvrđuje pristup digitalnim uslugama za privredu i stanovništvo.
   - Javno dostupna početna strana ne sadrži tehničku API specifikaciju potrebnu za adapter.
3. [Raiffeisen Bank International API Marketplace](https://api.rbinternational.com/)
   - Grupni marketplace potvrđuje postojanje API proizvoda u RBI grupi.
   - Ne dokazuje da je određeni proizvod ugovoren i dostupan za Raiffeisen banku a.d. Beograd niti daje ugovor za konkretan račun ove platforme.
4. [Raiffeisen Austria — NextGenPSD2 XS2A](https://developer.raiffeisen.at/xs2a-api)
   - Ovo je dokumentacija za austrijski PSD2/XS2A proizvod.
   - Ne sme se koristiti kao specifikacija za Raiffeisen Srbija.

Nezvanični GitHub klijenti, reverse-engineered mobilni/eBanking pozivi i dokumentacija drugih Raiffeisen pravnih lica nisu prihvatljiv ugovor.

## Obavezna dokumentacija pre implementacije

Banka ili ugovoreni provajder mora dostaviti dokument koji nedvosmisleno vezuje proizvod za Raiffeisen banku a.d. Beograd i potvrđuje:

| Stavka | Potrebna potvrda |
| --- | --- |
| Proizvod i okruženja | Tačan naziv proizvoda, sandbox/test i production bazni URL |
| Autentikacija | OAuth/auth grant, SCA/consent tok ako postoji, način klijentske autentikacije i sertifikati |
| Token | Tačan token endpoint, parametri, lifetime i obnova tokena |
| Izvodi/transakcije | Tačan statement/account-transactions endpoint i format odgovora |
| Scope-ovi | Minimalni potrebni scope-ovi/uloge i način njihovog odobravanja |
| Paginacija | Cursor/page pravila, redosled, završetak i ograničenja |
| Vremenski opseg | Maksimalni period po zahtevu, timezone, granice datuma i istorijska dubina |
| Stabilni ID | Polje koje je stabilni, globalno ili po računu jedinstveni ID transakcije i pravila za pending/booked promene |
| Ograničenja | Rate limits, retry/backoff, idempotency i SLA |
| Bezbednost | Dozvoljeni origin/IP, mTLS/QWAC zahtevi, rotacija i opoziv kredencijala |

## Granice buduće implementacije

Tek nakon potvrde svih stavki:

- adapter sme da normalizuje svaku stavku u postojeću internu granicu (`source`, `sourceItemId`, `reference`, `amountRsd`, `receivedAt`);
- kredencijali moraju ostati isključivo u deployment secrets;
- server ne sme logovati tokene, sertifikate ili sirove odgovore banke;
- sirovi izvod i kompletan payload banke ne smeju se čuvati;
- čuvaju se samo normalizovana polja i postojeći rezultat uparivanja;
- sync mora imati jasan status poslednjeg uspeha/neuspeha bez prikazivanja tajnih ili sirovih bankarskih podataka.