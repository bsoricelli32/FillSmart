# Notes for AI assistants working on FillSmart

## The Supabase project is shared

Supabase project `kvunlfjsdqrmafmilvrs` hosts FillSmart **and other, unrelated projects**.

- Before adding or changing any schema, storage bucket, pg_cron job, edge function or secret, read the
  registry: `select * from umbrella.projects;` (SQL editor or service role; it is not exposed through the API).
- FillSmart owns only what its row in `umbrella.projects` lists (schemas `public` and `private`, bucket
  `pump-photos`, its cron jobs and edge functions). Leave everything else alone, even if it looks unused.
- If FillSmart gains a new schema, bucket, cron job or edge function, update its row in `umbrella.projects`.
- The project's secret key is shared. Never rotate or revoke it without checking the registry first.

## This repo is public

Do not write the names or details of the other projects in this repo (code, docs, commit messages, migration
files). Details about them live in `umbrella.projects`, which is private.

## Migrations

Apply schema changes with Supabase `apply_migration`, then save the same SQL as the next numbered file in
`supabase/migrations/` (for example `0015_something.sql`). Keep the two in step.
