# LUMERA social prijava i Brevo e-mailovi

## Replit Secrets

U **Secrets** dodajte sledeće vrednosti pre uključivanja funkcionalnosti u produkciji:

| Secret | Namena |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth Client ID iz Google Cloud projekta |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret iz Google Cloud projekta |
| `FACEBOOK_APP_ID` | App ID Facebook aplikacije |
| `FACEBOOK_APP_SECRET` | App Secret Facebook aplikacije |
| `BREVO_SENDER_EMAIL` | Verifikovana Brevo e-mail adresa pošiljaoca |
| `BREVO_SENDER_NAME` | Opcioni prikazani naziv pošiljaoca, npr. `LUMERA` |
| `BREVO_API_KEY` | Opciona alternativa Replit Brevo konekciji za direktan Brevo API pristup |
| `SMS_PROVIDER_API_KEY` | Infobip API ključ za transakcione SMS poruke |
| `SMS_SENDER_NAME` | Odobreni Infobip naziv pošiljaoca, npr. `LUMERA` |
| `SMS_REMINDER_JOB_SECRET` | Nasumična tajna vrednost kojom dnevni posao poziva zaštićeni reminder endpoint |

U produkciji dodajte i običnu environment promenljivu `APP_BASE_URL` sa tačnim HTTPS korenom aplikacije, na primer `https://lumera.example.rs`. OAuth callback URL se nikada ne izvodi iz dolaznog zahteva u produkciji.

Brevo je već povezan sa projektom preko Replit konekcije. `BREVO_API_KEY` nije potreban dok je ta konekcija aktivna, ali `BREVO_SENDER_EMAIL` je obavezan da bi Brevo prihvatio slanje.

## OAuth callback URL-ovi

U Google Cloud Console i Facebook Developers konzoli dodajte sledeće callback URL-ove za svako okruženje:

```text
https://VAŠ-DOMEN/api/auth/oauth/google/callback
https://VAŠ-DOMEN/api/auth/oauth/facebook/callback
```

Za lokalni razvoj koristite URL koji prikazuje razvojni preview domen. Za objavljenu verziju koristite tačan produkcioni domen aplikacije.

Google aplikacija mora zahtevati `openid`, `email` i `profile` dozvole. Facebook aplikacija mora zahtevati `email` i `public_profile`.

## Bezbedno ponašanje bez konfiguracije

- OAuth dugmad vraćaju korisnika na odgovarajuću LUMERA prijavu sa jasnom porukom dok provajder nije konfigurisan.
- Slanje e-maila se evidentira kao preskočeno ako sender nije podešen; rezervacija, porudžbina ili edukacija se zbog toga ne prekidaju.
- Marketinška kampanja se ne kreira ako nema Brevo sender identitet ili ciljana publika nema primaoce.
- SMS potvrde se evidentiraju kao `skipped` dok SMS provider nije podešen, bez prekidanja rezervacije.

## Dnevni SMS podsetnici

Pokrenite zaseban Replit Scheduled Deployment svakog jutra (npr. `08:00` po vremenu Beograda) komandom:

```text
pnpm --filter @workspace/scripts run sms-reminders
```

Tom scheduled poslu dodajte `LUMERA_API_BASE_URL` (objavljeni HTTPS koren aplikacije) i isti `SMS_REMINDER_JOB_SECRET` kao API servisu. Posao poziva zaštićeni endpoint, bira potvrđene termine tog dana u zoni `Europe/Belgrade` i koristi idempotentni ključ, pa ponovljeno izvršavanje ne šalje duplikate.