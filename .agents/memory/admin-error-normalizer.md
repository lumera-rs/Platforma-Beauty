---
name: Admin 4xx error normalization
description: Admin-route 4xx JSON bodies lose every extra field unless they already carry a string code.
---

A response-shaping middleware wraps all `/admin/...` API routes: any 4xx response whose JSON body has a string `error` but **no string `code`** is rewritten to just `{ error, code }` (plus zod `issues`). Any other fields in the body — flags, states, structured data — are silently dropped.

**Why:** A 409 verdict payload carrying `state`/`verified` fields reached the client as `{ error, code: "CONFLICT" }` only, failing assertions confusingly: the route source clearly set the fields, but the wire body lacked them.

**How to apply:** When an admin-route 4xx response must carry structured fields beyond the message, set the contract's `code` explicitly in the same body (e.g. `code: "CONFLICT"` for 409) — the normalizer then passes the body through untouched. 2xx and 5xx responses are never rewritten.
