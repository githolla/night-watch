-- Isolated test database only. This fixture is not a production migration.
create role anon;
create role authenticated;
create role service_role bypassrls;
create type app_owner as enum ('josh','suuchi');
create table people (id uuid primary key, email text, do_not_contact boolean not null default false);
create table cadences (id uuid primary key, person_id uuid references people, status text);
create table touches (id uuid primary key, person_id uuid references people, bounced_at timestamptz, reply_at timestamptz);
create table cards (id uuid primary key, person_id uuid references people, status text);

create table cadence_steps(id uuid primary key, cadence_id uuid references cadences, status text, sent_at timestamptz, error text);
