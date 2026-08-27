---
name: Generated API error guard coverage
description: How frontend error-access regressions stay covered as generated-client screens are added.
---

Production frontend source that imports the generated API client must be discovered dynamically by the regression guard, rather than maintained in a hand-picked list. Generated-client failures are read through the shared error helpers; native `fetch` responses may be read as `Response` values only in their own fetch-oriented flow.

**Why:** A new page can import a generated mutation hook without being added to a static test list, silently reintroducing Axios-shaped `error.response` access or unsafe casts that hide the server's user-safe error message.

**How to apply:** When adding a frontend source file or changing a generated-client error handler, keep direct error payload/status access out of it and use `getApiErrorMessage` or `getApiErrorDetails`. Keep deliberately native-fetch response parsing separate from generated-client error handling, and update the negative fixture only when the prohibited pattern set changes.