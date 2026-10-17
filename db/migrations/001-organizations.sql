-- Organizations (docs/adr/013-organizations.md): an organization owns teams whose plays and playbooks
-- are rows of their own, so two coaches drawing different plays never overwrite each other and a device
-- can ask for what changed since the rev it last read. A coach's own teams and the share links stay in
-- Redis (ADR 001, ADR 012); nothing here reads them.

create table if not exists orgs (
  id text primary key,
  name text not null,
  owner text not null,
  created timestamptz not null default now()
);

create table if not exists memberships (
  org text not null references orgs(id) on delete cascade,
  coach text not null,
  -- the coach's name as the account last showed it, for the members list and for plays they touched
  name text not null,
  role text not null check (role in ('owner', 'admin', 'member')),
  -- the teams this member sees: null is every team, else the list set on the invite or by an admin
  teams text[],
  heads text[] not null default '{}',
  assists text[] not null default '{}',
  -- the invite that brought them, so an admin can see who joined by which link
  invited_by text,
  joined timestamptz not null default now(),
  primary key (org, coach)
);
create index if not exists memberships_coach on memberships (coach);

create table if not exists invites (
  token text primary key,
  org text not null references orgs(id) on delete cascade,
  by text not null,
  -- lower-cased; null for a link anyone may use until it expires
  email text,
  teams text[],
  heads text[] not null default '{}',
  assists text[] not null default '{}',
  created timestamptz not null default now(),
  expires timestamptz not null
);
create index if not exists invites_org on invites (org);
create index if not exists invites_email on invites (email) where email is not null;

create table if not exists org_teams (
  id text primary key,
  org text not null references orgs(id) on delete cascade,
  name text not null,
  color text not null,
  settings jsonb not null,
  lineups jsonb not null,
  -- the write count: every write to the team or anything in it bumps it, and every row says the rev it last changed at
  rev integer not null default 1,
  settings_rev integer not null default 1,
  made_by text not null,
  made_name text not null,
  made_at timestamptz not null default now(),
  changed_by text not null,
  changed_name text not null,
  changed_at timestamptz not null default now()
);
create index if not exists org_teams_org on org_teams (org);

create table if not exists org_plays (
  team text not null references org_teams(id) on delete cascade,
  id text not null,
  -- null once deleted: the row is a tombstone for 30 days, so a device that still holds the play drops it
  play jsonb,
  rev integer not null,
  made_by text not null,
  made_name text not null,
  made_at timestamptz not null,
  changed_by text not null,
  changed_name text not null,
  -- when the coach made the change on their device, not when it arrived: the later change wins (rule 5)
  changed_at timestamptz not null,
  deleted timestamptz,
  from_team text,
  from_play text,
  primary key (team, id)
);
create index if not exists org_plays_rev on org_plays (team, rev);

create table if not exists org_books (
  team text not null references org_teams(id) on delete cascade,
  id text not null,
  book jsonb,
  rev integer not null,
  made_by text not null,
  made_name text not null,
  made_at timestamptz not null,
  changed_by text not null,
  changed_name text not null,
  changed_at timestamptz not null,
  deleted timestamptz,
  from_team text,
  from_book text,
  primary key (team, id)
);
create index if not exists org_books_rev on org_books (team, rev);
