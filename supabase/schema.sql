-- ============================================================
-- Vigilante — Supabase Schema
-- Run this once in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── wallet_registry ──────────────────────────────────────────
-- One row per unique wallet address. Updated on every scan.
create table wallet_registry (
  id              uuid default uuid_generate_v4() primary key,
  address         text not null unique,
  chain           text not null,
  entity          text,
  latest_score    integer,
  latest_decision text,
  scan_count      integer default 1,
  first_scan      timestamptz,
  last_scan       timestamptz,
  trend           integer default 0,
  status_flag     text default 'NEW',
  balance         text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ── wallet_scans ─────────────────────────────────────────────
-- Immutable scan record. One row per scan event. Never updated.
create table wallet_scans (
  id              uuid default uuid_generate_v4() primary key,
  address         text not null,
  chain           text not null,
  scanned_at      timestamptz not null,
  overall_score   integer not null,
  risk_level      text not null,
  decision        text not null,
  entity          text,
  entity_source   text,
  balance         text,
  tx_count        integer,
  first_seen      text,
  signals         jsonb,
  counterparties  jsonb,
  token_activity  jsonb,
  hop_node_count  integer default 0,
  direct_match    boolean default false,
  funding_wallet  text,
  api_source      text,
  analyst_note    text,
  status_flag     text,
  score_delta     integer default 0,
  scanned_by      uuid references auth.users(id),
  scanned_by_email text,
  created_at      timestamptz default now()
);

-- ── scan_changes ─────────────────────────────────────────────
-- One row per detected change between consecutive scans.
create table scan_changes (
  id           uuid default uuid_generate_v4() primary key,
  address      text not null,
  scan_id      uuid references wallet_scans(id) on delete cascade,
  change_type  text not null,
  field        text not null,
  from_value   text,
  to_value     text,
  delta        numeric,
  severity     text,
  created_at   timestamptz default now()
);

-- ── Indexes ───────────────────────────────────────────────────
create index idx_wallet_scans_address    on wallet_scans(address);
create index idx_wallet_scans_scanned_at on wallet_scans(scanned_at desc);
create index idx_scan_changes_address    on scan_changes(address);
create index idx_scan_changes_scan_id    on scan_changes(scan_id);

-- ── Row Level Security ────────────────────────────────────────
-- Any authenticated team member can read and write all tables.

alter table wallet_registry enable row level security;
alter table wallet_scans    enable row level security;
alter table scan_changes    enable row level security;

create policy "team_all_registry"
  on wallet_registry for all
  using (auth.role() = 'authenticated');

create policy "team_all_scans"
  on wallet_scans for all
  using (auth.role() = 'authenticated');

create policy "team_all_changes"
  on scan_changes for all
  using (auth.role() = 'authenticated');

-- ── Auto-update updated_at ────────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger wallet_registry_updated_at
  before update on wallet_registry
  for each row execute function update_updated_at();
