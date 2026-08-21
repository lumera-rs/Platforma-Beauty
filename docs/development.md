# LUMERA development notes

## Local demonstration accounts

Use the following accounts only in the development environment:

| Purpose | Email | Password |
| --- | --- | --- |
| Platform administrator | `admin@lumera.local` | `LumeraDemo2026!` |
| Salon owner | `salon@lumera.local` | `LumeraDemo2026!` |
| Education center owner | `edukacija@lumera.local` | `LumeraDemo2026!` |
| Customer | `kupac@lumera.local` | `LumeraDemo2026!` |

These accounts are created during the first local API request. They are intentionally documented here rather than surfaced in the public product interface.

## Browser checks

- `pnpm run test:booking-journey` — run only the booking journey browser specifications
- `pnpm run test:browser` — run the complete browser specification suite