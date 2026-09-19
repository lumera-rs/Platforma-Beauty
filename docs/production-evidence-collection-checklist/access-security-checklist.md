# Database access security checklist

Future evidence must establish:

- dedicated read-only identity and expiry;
- exact effective grants and role memberships;
- no DDL/DML, owner, bypass, write fallback or unapproved function execution;
- no `SET ROLE` or other escalation path;
- one-connection enforcement;
- `statement_timeout=15000ms`, `lock_timeout=1000ms`,
  `idle_in_transaction_session_timeout=10000ms`;
- transaction read-only verification before every statement;
- audit attribution and safe cancel/rollback/reset/release evidence.

Repository role names, intended grants, credentials or a successful connection
do not prove effective least privilege. No secret value or connection string
may be submitted. This checklist does not connect to a database.