-- Project registry. This Supabase project is shared by more than one independent project.
-- umbrella.projects records which project owns each schema, storage bucket, cron job and edge function,
-- so nobody (person or AI assistant) changes something that belongs to another project.
-- Not exposed through the API: only the service role and the SQL editor can read it.
create schema if not exists umbrella;
comment on schema umbrella is
  'Project registry. This Supabase project hosts more than one independent project. '
  'Read umbrella.projects before adding or changing schemas, storage buckets, cron jobs, edge functions or secrets.';
revoke all on schema umbrella from anon, authenticated;

create table umbrella.projects (
  slug text primary key,
  name text not null,
  status text not null default 'active',
  schemas text[] not null default '{}',
  buckets text[] not null default '{}',
  cron_jobs text[] not null default '{}',
  edge_functions text[] not null default '{}',
  repo text,
  notes text,
  updated_at timestamptz not null default now()
);
alter table umbrella.projects enable row level security;
revoke all on umbrella.projects from anon, authenticated;

comment on table umbrella.projects is
  'One row per project living in this Supabase project. Update the row when a project adds or removes resources.';
comment on column umbrella.projects.schemas is 'Postgres schemas this project owns. Do not create tables for one project in another project''s schema.';
comment on column umbrella.projects.buckets is 'Storage buckets this project owns.';
comment on column umbrella.projects.cron_jobs is 'pg_cron job names this project owns.';
comment on column umbrella.projects.edge_functions is 'Edge functions this project owns.';
comment on column umbrella.projects.notes is 'How the project uses this Supabase project, secrets it relies on, and rules for working on it.';

comment on schema public is
  'FillSmart app tables. This Supabase project is shared; see umbrella.projects for which project owns what.';
