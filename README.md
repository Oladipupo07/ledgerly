# Ledgerly MVP starter

This is a copyable Next.js + TypeScript starter for Ledgerly's responsive dashboard slice. It uses synthetic presentation data only. It is not yet connected to an identity provider or database.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:3000. Run `npm run lint`, `npm run typecheck`, and `npm run build` before extending the starter.

## Included

- Responsive overview and deterministic Money Brief example.
- NGN formatting from integer kobo.
- Server-only tenant membership guard example. Connect this to verified auth before exposing data.
- Product decisions and gaps in `DECISIONS.md`.

No live financial data, payment initiation, bank connection, lending, AI advice, or custody is implemented.
