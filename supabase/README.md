# Supabase migrations (Phase 3+)

Production PostgreSQL schema for K-Shop. **Authoritative spec:**
[`../BACKEND_SPEC.md`](../BACKEND_SPEC.md) (44 sections).

## Files (apply in order)

| File | Spec sections | Contents |
|------|---------------|----------|
| `migrations/0001_init_schema.sql` | §3, §8, §10–§12, §16–§17, §20, §22–§23, §25–§29, §36 | Enums, all tables, CHECK/UNIQUE constraints, indexes, server-generated numbers (KS-/RT-/TXN-), KNCR/KNSR ids |
| `migrations/0002_functions_triggers.sql` | §8, §28, §31, §36 | `updated_at` maintenance, profile identity trigger (roles + business id), append-only triggers for financial/audit/history tables |
| `migrations/0003_rls_policies.sql` | §33 | RLS enabled on every table (deny-by-default), client-role grants stripped, owner-scoped SELECT policies only, explicit service-role access |

Later backend phases append their own files (`0004_…`, `0005_…`) — never edit
an applied migration; add a new one.

## Ground rules

- **Only the Express backend (service-role connection) writes.** The browser
  never connects to Postgres; `anon`/`authenticated` get nothing but
  owner-scoped reads as defence in depth.
- Ids, order/return/transaction numbers, roles, and business ids
  (`KNCR-…`/`KNSR-…`) are generated **inside the database** — never trusted
  from a client.
- Financial and audit rows are **append-only** (triggers raise on
  UPDATE/DELETE); corrections are compensating rows.

## Verifying locally (no Docker/system Postgres needed)

```powershell
cd server/tests/pg-harness
npm install   # first time only
npm test      # boots embedded PostgreSQL, applies shim + all migrations,
              # runs 35 schema/RLS assertions — exit 0 = all passed
```

`shim.sql` (test-only) emulates the Supabase-managed `auth` schema/roles that
already exist on a real Supabase project. It is **never** applied to Supabase.

## Applying to a real Supabase project

With the Supabase CLI linked to the project:

```powershell
supabase db push          # or: supabase migration up
```

The project must be provisioned with the standard roles (`anon`,
`authenticated`, `service_role`) and the `auth` schema — both are
auto-created by Supabase; `0003` references them.
