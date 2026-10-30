-- TurniRUM: schema, row level security and RPC functions.
-- All writes from the browser go through SECURITY DEFINER functions that validate input;
-- PayPal payments are written only by the `paypal` Edge Function (service role).

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------- tables --

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  full_name  text not null,
  role       text not null,
  created_at timestamptz not null default now(),
  constraint profiles_role check (role in ('organizer', 'participant', 'creator')),
  constraint profiles_username check (username ~ '^[A-Za-z0-9_.-]{3,32}$'),
  constraint profiles_full_name check (char_length(btrim(full_name)) between 2 and 60)
);
create unique index profiles_username_key on public.profiles (lower(username));

create table public.tournaments (
  id            bigint generated always as identity primary key,
  organizer_id  uuid not null references public.profiles (id) on delete cascade,
  title         text not null,
  game          text not null,
  description   text not null default '',
  format        text not null default 'online',
  city          text not null default '',
  start_at      timestamptz not null,
  max_teams     integer not null default 16,
  team_size     integer not null default 5,
  is_paid       boolean not null default false,
  entry_fee     numeric(10, 2) not null default 0,
  prize_percent integer not null default 60,
  prize_note    text not null default '',
  status        text not null default 'registration',
  created_at    timestamptz not null default now(),
  constraint tournaments_title check (char_length(btrim(title)) between 3 and 80),
  constraint tournaments_game check (char_length(btrim(game)) between 1 and 40),
  constraint tournaments_description check (char_length(description) <= 2000),
  constraint tournaments_format check (format in ('online', 'offline')),
  constraint tournaments_city check (char_length(city) <= 80 and (format = 'online' or char_length(btrim(city)) > 0)),
  constraint tournaments_max_teams check (max_teams between 2 and 256),
  constraint tournaments_team_size check (team_size between 1 and 12),
  constraint tournaments_fee check (entry_fee between 0 and 10000 and (not is_paid or entry_fee >= 1)),
  constraint tournaments_prize_percent check (prize_percent between 0 and 90),
  constraint tournaments_prize_note check (char_length(prize_note) <= 200),
  constraint tournaments_status check (status in ('registration', 'active', 'finished'))
);
create index tournaments_organizer_idx on public.tournaments (organizer_id);

-- Where the organizer receives payouts. Only the organizer and the platform creator can read it.
create table public.tournament_payouts (
  tournament_id bigint primary key references public.tournaments (id) on delete cascade,
  paypal_email  text not null,
  updated_at    timestamptz not null default now(),
  constraint tournament_payouts_email check (
    char_length(paypal_email) <= 254 and paypal_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create table public.teams (
  id                bigint generated always as identity primary key,
  tournament_id     bigint not null references public.tournaments (id) on delete cascade,
  captain_id        uuid references public.profiles (id) on delete set null,
  name              text not null,
  name_key          text generated always as (lower(btrim(name))) stored,
  members           text[] not null default '{}',
  wins              integer not null default 0,
  draws             integer not null default 0,
  losses            integer not null default 0,
  score_for         integer not null default 0,
  score_against     integer not null default 0,
  points            integer not null default 0,
  is_paid           boolean not null default false,
  payment_method    text,
  paid_amount       numeric(10, 2) not null default 0,
  paid_at           timestamptz,
  paypal_order_id   text unique,
  paypal_capture_id text,
  created_at        timestamptz not null default now(),
  constraint teams_name check (char_length(btrim(name)) between 2 and 40),
  constraint teams_members check (cardinality(members) <= 12),
  constraint teams_stats check (
    wins between 0 and 99999 and draws between 0 and 99999 and losses between 0 and 99999 and
    score_for between 0 and 99999 and score_against between 0 and 99999 and points between 0 and 99999),
  constraint teams_payment_method check (payment_method in ('paypal', 'manual')),
  constraint teams_paid check (
    (is_paid and payment_method is not null) or (not is_paid and payment_method is null and paid_amount = 0)),
  -- Deferred so that two teams can swap names inside one save.
  constraint teams_name_unique unique (tournament_id, name_key) deferrable initially deferred
);
create unique index teams_captain_unique on public.teams (tournament_id, captain_id) where captain_id is not null;
create index teams_captain_idx on public.teams (captain_id);

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  tournament_id     bigint references public.tournaments (id) on delete set null,
  tournament_title  text not null,
  user_id           uuid references public.profiles (id) on delete set null,
  team_id           bigint references public.teams (id) on delete set null,
  team_name         text not null,
  members           text[] not null default '{}',
  amount            numeric(10, 2) not null,
  currency          text not null default 'USD',
  status            text not null default 'created',
  paypal_order_id   text unique,
  paypal_capture_id text,
  payer_email       text,
  payer_name        text,
  failure_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint payments_status check (status in ('created', 'completed', 'pending', 'failed', 'refunded'))
);
create index payments_user_idx on public.payments (user_id);
create index payments_tournament_idx on public.payments (tournament_id);
create index payments_team_idx on public.payments (team_id);

-- Server-only settings (read by Edge Functions with the secret key).
create table public.app_settings (
  key   text primary key,
  value text not null
);
insert into public.app_settings (key, value) values
  -- SHA-256 of the password that turns an account into the platform creator.
  ('creator_password_sha256', 'e2d98fda3f7e356c5763616f0e6db8657678c0b14b8038ec1643f1bd83708115');

-- --------------------------------------------------------------- overview --

create view public.tournament_overview with (security_invoker = on) as
select t.id, t.organizer_id, t.title, t.game, t.description, t.format, t.city, t.start_at,
       t.max_teams, t.team_size, t.is_paid, t.entry_fee, t.prize_percent, t.prize_note, t.status, t.created_at,
       p.full_name as organizer_name,
       p.username  as organizer_username,
       coalesce(s.team_count, 0)::integer        as team_count,
       coalesce(s.paid_count, 0)::integer        as paid_count,
       coalesce(s.collected, 0)::numeric(12, 2)  as collected
from public.tournaments t
join public.profiles p on p.id = t.organizer_id
left join lateral (
  select count(*)                                   as team_count,
         count(*) filter (where tm.is_paid)         as paid_count,
         sum(tm.paid_amount) filter (where tm.is_paid) as collected
  from public.teams tm
  where tm.tournament_id = t.id
) s on true;

-- ------------------------------------------------------------------- RLS --

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_payouts enable row level security;
alter table public.teams enable row level security;
alter table public.payments enable row level security;
alter table public.app_settings enable row level security;

create or replace function private.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid())
$$;
revoke all on function private.my_role() from public;
grant execute on function private.my_role() to anon, authenticated, service_role;

create policy "Profiles are public" on public.profiles
  for select to anon, authenticated using (true);

create policy "Tournaments are public" on public.tournaments
  for select to anon, authenticated using (true);

create policy "Teams are public" on public.teams
  for select to anon, authenticated using (true);

create policy "Organizer and creator read payout details" on public.tournament_payouts
  for select to authenticated using (
    (select private.my_role()) = 'creator'
    or exists (select 1 from public.tournaments t
               where t.id = tournament_id and t.organizer_id = (select auth.uid())));

create policy "Payer, organizer and creator read payments" on public.payments
  for select to authenticated using (
    user_id = (select auth.uid())
    or (select private.my_role()) = 'creator'
    or exists (select 1 from public.tournaments t
               where t.id = tournament_id and t.organizer_id = (select auth.uid())));

-- No direct writes from the browser: everything goes through the functions below.
revoke insert, update, delete, truncate on public.profiles, public.tournaments, public.tournament_payouts,
  public.teams, public.payments, public.app_settings from anon, authenticated;
revoke select on public.app_settings from anon, authenticated;

-- PayPal identifiers stay private; every other team column is public.
revoke select on public.teams from anon, authenticated;
grant select (id, tournament_id, captain_id, name, members, wins, draws, losses, score_for, score_against,
              points, is_paid, payment_method, paid_amount, paid_at, created_at)
  on public.teams to anon, authenticated;

grant select on public.tournament_overview to anon, authenticated;

-- ---------------------------------------------------------------- helpers --

create or replace function private.clean_members(p_members text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(left(btrim(m), 40) order by ord), '{}')
  from unnest(coalesce(p_members, '{}'::text[])) with ordinality as u(m, ord)
  where btrim(m) <> ''
$$;

-- Raises a readable error if this user cannot register this team right now.
-- The caller must hold a FOR UPDATE lock on the tournament row.
create or replace function private.assert_can_join(
  p_tournament public.tournaments, p_user_id uuid, p_name text, p_members text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = p_user_id;
  if v_role is distinct from 'participant' then
    raise exception 'Only participant accounts can register teams.';
  end if;
  if p_tournament.status <> 'registration' then
    raise exception 'Registration for this tournament is closed.';
  end if;
  if (select count(*) from public.teams where tournament_id = p_tournament.id) >= p_tournament.max_teams then
    raise exception 'All slots in this tournament are taken.';
  end if;
  if exists (select 1 from public.teams where tournament_id = p_tournament.id and captain_id = p_user_id) then
    raise exception 'You have already registered a team for this tournament.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 40 then
    raise exception 'Team name must be 2–40 characters long.';
  end if;
  if exists (select 1 from public.teams
             where tournament_id = p_tournament.id and name_key = lower(btrim(p_name))) then
    raise exception 'A team with this name is already registered.';
  end if;
  if cardinality(p_members) < 1 then
    raise exception 'Add at least one player to the roster.';
  end if;
  if cardinality(p_members) > p_tournament.team_size then
    raise exception 'A team can have at most % players.', p_tournament.team_size;
  end if;
end;
$$;

create or replace function private.owned_tournament(p_tournament_id bigint)
returns public.tournaments
language plpgsql
set search_path = ''
as $$
declare
  v_t public.tournaments;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found or v_t.organizer_id is distinct from (select auth.uid()) then
    raise exception 'Tournament not found.';
  end if;
  return v_t;
end;
$$;

-- ------------------------------------------------------ participant RPCs --

create or replace function public.join_free_tournament(p_tournament_id bigint, p_name text, p_members text[])
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_t       public.tournaments;
  v_members text[] := private.clean_members(p_members);
  v_id      bigint;
begin
  if v_uid is null then
    raise exception 'Please sign in first.';
  end if;
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Tournament not found.';
  end if;
  if v_t.is_paid then
    raise exception 'This tournament has an entry fee — please pay with PayPal.';
  end if;
  perform private.assert_can_join(v_t, v_uid, p_name, v_members);
  insert into public.teams (tournament_id, captain_id, name, members)
  values (v_t.id, v_uid, btrim(p_name), v_members)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.leave_tournament(p_tournament_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_t    public.tournaments;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  select * into v_team from public.teams
  where tournament_id = p_tournament_id and captain_id = (select auth.uid());
  if v_team.id is null then
    raise exception 'You are not registered for this tournament.';
  end if;
  if v_t.status <> 'registration' then
    raise exception 'The tournament has already started, so your team cannot leave it.';
  end if;
  if v_team.is_paid then
    raise exception 'Your entry fee is already paid. Contact the organizer about a refund.';
  end if;
  delete from public.teams where id = v_team.id;
end;
$$;

-- -------------------------------------------------------- organizer RPCs --

create or replace function public.save_tournament(p_id bigint, p_data jsonb, p_payout_email text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_t        public.tournaments;
  v_id       bigint;
  v_is_paid  boolean := coalesce((p_data ->> 'is_paid')::boolean, false);
  v_fee      numeric := case when v_is_paid then coalesce((p_data ->> 'entry_fee')::numeric, 0) else 0 end;
  v_format   text := coalesce(p_data ->> 'format', 'online');
  v_start    timestamptz := (p_data ->> 'start_at')::timestamptz;
  v_max      integer := (p_data ->> 'max_teams')::integer;
  v_email    text := nullif(btrim(coalesce(p_payout_email, '')), '');
begin
  if (select private.my_role()) is distinct from 'organizer' then
    raise exception 'Only organizers can create tournaments.';
  end if;
  if char_length(btrim(coalesce(p_data ->> 'title', ''))) not between 3 and 80 then
    raise exception 'The title must be 3–80 characters long.';
  end if;
  if char_length(btrim(coalesce(p_data ->> 'game', ''))) not between 1 and 40 then
    raise exception 'Choose the game or discipline.';
  end if;
  if v_format = 'offline' and btrim(coalesce(p_data ->> 'city', '')) = '' then
    raise exception 'Add the city and venue for an offline tournament.';
  end if;
  if v_start is null then
    raise exception 'Choose the start date and time.';
  end if;
  if v_max is null or v_max not between 2 and 256 then
    raise exception 'The team limit must be between 2 and 256.';
  end if;
  if coalesce((p_data ->> 'team_size')::integer, 0) not between 1 and 12 then
    raise exception 'Players per team must be between 1 and 12.';
  end if;
  if coalesce((p_data ->> 'prize_percent')::integer, 60) not between 0 and 90 then
    raise exception 'The prize pool share must be between 0%% and 90%%.';
  end if;
  if v_is_paid and (v_fee < 1 or v_fee > 10000) then
    raise exception 'The entry fee must be between $1 and $10,000.';
  end if;
  if v_is_paid and v_email is null then
    raise exception 'Add the PayPal email where you want to receive payouts.';
  end if;

  if p_id is null then
    if v_start < now() - interval '1 day' then
      raise exception 'The start date cannot be in the past.';
    end if;
    insert into public.tournaments (organizer_id, title, game, description, format, city, start_at, max_teams,
                                    team_size, is_paid, entry_fee, prize_percent, prize_note)
    values (v_uid, btrim(p_data ->> 'title'), btrim(p_data ->> 'game'), coalesce(p_data ->> 'description', ''),
            v_format, case when v_format = 'offline' then btrim(coalesce(p_data ->> 'city', '')) else '' end,
            v_start, v_max, (p_data ->> 'team_size')::integer, v_is_paid, round(v_fee, 2),
            coalesce((p_data ->> 'prize_percent')::integer, 60), btrim(coalesce(p_data ->> 'prize_note', '')))
    returning id into v_id;
  else
    v_t := private.owned_tournament(p_id);
    if v_max < (select count(*) from public.teams where tournament_id = p_id) then
      raise exception 'More teams are already registered than the new limit allows.';
    end if;
    update public.tournaments set
      title = btrim(p_data ->> 'title'),
      game = btrim(p_data ->> 'game'),
      description = coalesce(p_data ->> 'description', ''),
      format = v_format,
      city = case when v_format = 'offline' then btrim(coalesce(p_data ->> 'city', '')) else '' end,
      start_at = v_start,
      max_teams = v_max,
      team_size = (p_data ->> 'team_size')::integer,
      is_paid = v_is_paid,
      entry_fee = round(v_fee, 2),
      prize_percent = coalesce((p_data ->> 'prize_percent')::integer, 60),
      prize_note = btrim(coalesce(p_data ->> 'prize_note', ''))
    where id = p_id;
    v_id := p_id;
  end if;

  if v_is_paid then
    insert into public.tournament_payouts (tournament_id, paypal_email) values (v_id, v_email)
    on conflict (tournament_id) do update set paypal_email = excluded.paypal_email, updated_at = now();
  end if;
  return v_id;
end;
$$;

create or replace function public.set_tournament_status(p_tournament_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.owned_tournament(p_tournament_id);
  if p_status not in ('registration', 'active', 'finished') then
    raise exception 'Unknown status.';
  end if;
  update public.tournaments set status = p_status where id = p_tournament_id;
end;
$$;

create or replace function public.organizer_add_team(
  p_tournament_id bigint, p_name text, p_members text[], p_paid boolean default false)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t       public.tournaments := private.owned_tournament(p_tournament_id);
  v_members text[] := private.clean_members(p_members);
  v_paid    boolean := v_t.is_paid and coalesce(p_paid, false);
  v_id      bigint;
begin
  if (select count(*) from public.teams where tournament_id = v_t.id) >= v_t.max_teams then
    raise exception 'The team limit is reached. Raise it in the tournament settings.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 40 then
    raise exception 'Team name must be 2–40 characters long.';
  end if;
  if exists (select 1 from public.teams where tournament_id = v_t.id and name_key = lower(btrim(p_name))) then
    raise exception 'A team with this name already exists.';
  end if;
  if cardinality(v_members) > v_t.team_size then
    raise exception 'A team can have at most % players.', v_t.team_size;
  end if;
  insert into public.teams (tournament_id, name, members, is_paid, payment_method, paid_amount, paid_at)
  values (v_t.id, btrim(p_name), v_members, v_paid,
          case when v_paid then 'manual' end, case when v_paid then v_t.entry_fee else 0 end,
          case when v_paid then now() end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.organizer_delete_team(p_team_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id bigint;
begin
  select tournament_id into v_tournament_id from public.teams where id = p_team_id;
  perform private.owned_tournament(v_tournament_id);
  delete from public.teams where id = p_team_id;
end;
$$;

-- p_rows: [{id, name, members[], wins, draws, losses, score_for, score_against, points, paid}]
create or replace function public.organizer_save_table(
  p_tournament_id bigint, p_rows jsonb, p_auto_points boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t      public.tournaments := private.owned_tournament(p_tournament_id);
  v_row    jsonb;
  v_team   public.teams;
  v_name   text;
  v_wins   integer;
  v_draws  integer;
  v_losses integer;
  v_for    integer;
  v_against integer;
  v_points integer;
  v_paid   boolean;
  v_members text[];
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Nothing to save.';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    select * into v_team from public.teams
    where id = (v_row ->> 'id')::bigint and tournament_id = v_t.id for update;
    continue when not found;

    v_name := btrim(coalesce(v_row ->> 'name', v_team.name));
    if char_length(v_name) not between 2 and 40 then
      raise exception 'Team name "%" must be 2–40 characters long.', v_name;
    end if;
    v_wins    := greatest(0, least(99999, coalesce((v_row ->> 'wins')::integer, v_team.wins)));
    v_draws   := greatest(0, least(99999, coalesce((v_row ->> 'draws')::integer, v_team.draws)));
    v_losses  := greatest(0, least(99999, coalesce((v_row ->> 'losses')::integer, v_team.losses)));
    v_for     := greatest(0, least(99999, coalesce((v_row ->> 'score_for')::integer, v_team.score_for)));
    v_against := greatest(0, least(99999, coalesce((v_row ->> 'score_against')::integer, v_team.score_against)));
    v_points  := case when p_auto_points then least(99999, v_wins * 3 + v_draws)
                      else greatest(0, least(99999, coalesce((v_row ->> 'points')::integer, v_team.points))) end;
    if v_row ? 'members' and jsonb_typeof(v_row -> 'members') = 'array' then
      v_members := private.clean_members(array(select jsonb_array_elements_text(v_row -> 'members')));
      if cardinality(v_members) > v_t.team_size then
        raise exception 'Team "%" can have at most % players.', v_name, v_t.team_size;
      end if;
    else
      v_members := v_team.members;
    end if;

    update public.teams set
      name = v_name, members = v_members,
      wins = v_wins, draws = v_draws, losses = v_losses,
      score_for = v_for, score_against = v_against, points = v_points
    where id = v_team.id;

    -- Organizers may mark offline payments; PayPal payments are verified automatically and stay untouched.
    if v_t.is_paid and v_team.payment_method is distinct from 'paypal' and v_row ? 'paid' then
      v_paid := coalesce((v_row ->> 'paid')::boolean, false);
      if v_paid and not v_team.is_paid then
        update public.teams set is_paid = true, payment_method = 'manual', paid_amount = v_t.entry_fee,
                                paid_at = now() where id = v_team.id;
      elsif not v_paid and v_team.is_paid then
        update public.teams set is_paid = false, payment_method = null, paid_amount = 0, paid_at = null
        where id = v_team.id;
      end if;
    end if;
  end loop;

  if exists (select 1 from public.teams where tournament_id = v_t.id
             group by name_key having count(*) > 1) then
    raise exception 'Two teams cannot have the same name.';
  end if;
end;
$$;

-- ---------------------------------------------------------- creator RPCs --

create or replace function public.admin_delete_tournament(p_tournament_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.my_role()) is distinct from 'creator' then
    raise exception 'Only the platform creator can delete tournaments.';
  end if;
  delete from public.tournaments where id = p_tournament_id;
  if not found then
    raise exception 'Tournament not found.';
  end if;
end;
$$;

create or replace function public.admin_list_users()
returns table (
  id uuid, username text, full_name text, role text, email text, created_at timestamptz,
  tournaments_count bigint, teams_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.my_role()) is distinct from 'creator' then
    raise exception 'Only the platform creator can see the user list.';
  end if;
  return query
    select p.id, p.username, p.full_name, p.role, u.email::text, p.created_at,
           (select count(*) from public.tournaments t where t.organizer_id = p.id),
           (select count(*) from public.teams tm where tm.captain_id = p.id)
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

-- ------------------------------------------------- PayPal (service role) --

-- Validates a paid registration and records the pending payment before the PayPal order is created.
create or replace function public.paypal_start_payment(
  p_user_id uuid, p_tournament_id bigint, p_name text, p_members text[])
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t       public.tournaments;
  v_members text[] := private.clean_members(p_members);
  v_payment public.payments;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Tournament not found.';
  end if;
  if not v_t.is_paid then
    raise exception 'This tournament is free — no payment is needed.';
  end if;
  perform private.assert_can_join(v_t, p_user_id, p_name, v_members);
  insert into public.payments (tournament_id, tournament_title, user_id, team_name, members, amount, currency)
  values (v_t.id, v_t.title, p_user_id, btrim(p_name), v_members, v_t.entry_fee, 'USD')
  returning * into v_payment;
  return v_payment;
end;
$$;

-- Called after PayPal confirmed the capture: admits the team, or raises if it can no longer join.
create or replace function public.paypal_admit_team(
  p_payment_id uuid, p_capture_id text, p_payer_email text, p_payer_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p    public.payments;
  v_t    public.tournaments;
  v_team bigint;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'Payment not found.';
  end if;
  if v_p.status = 'completed' then
    return v_p.team_id;
  end if;
  select * into v_t from public.tournaments where id = v_p.tournament_id for update;
  if not found then
    raise exception 'The tournament no longer exists.';
  end if;
  perform private.assert_can_join(v_t, v_p.user_id, v_p.team_name, v_p.members);
  insert into public.teams (tournament_id, captain_id, name, members, is_paid, payment_method, paid_amount,
                            paid_at, paypal_order_id, paypal_capture_id)
  values (v_t.id, v_p.user_id, v_p.team_name, v_p.members, true, 'paypal', v_p.amount, now(),
          v_p.paypal_order_id, p_capture_id)
  returning id into v_team;
  update public.payments set status = 'completed', team_id = v_team, paypal_capture_id = p_capture_id,
                             payer_email = p_payer_email, payer_name = p_payer_name, updated_at = now()
  where id = p_payment_id;
  return v_team;
end;
$$;

-- ---------------------------------------------------------------- grants --

revoke all on function public.join_free_tournament(bigint, text, text[]) from public, anon;
revoke all on function public.leave_tournament(bigint) from public, anon;
revoke all on function public.save_tournament(bigint, jsonb, text) from public, anon;
revoke all on function public.set_tournament_status(bigint, text) from public, anon;
revoke all on function public.organizer_add_team(bigint, text, text[], boolean) from public, anon;
revoke all on function public.organizer_delete_team(bigint) from public, anon;
revoke all on function public.organizer_save_table(bigint, jsonb, boolean) from public, anon;
revoke all on function public.admin_delete_tournament(bigint) from public, anon;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.join_free_tournament(bigint, text, text[]) to authenticated;
grant execute on function public.leave_tournament(bigint) to authenticated;
grant execute on function public.save_tournament(bigint, jsonb, text) to authenticated;
grant execute on function public.set_tournament_status(bigint, text) to authenticated;
grant execute on function public.organizer_add_team(bigint, text, text[], boolean) to authenticated;
grant execute on function public.organizer_delete_team(bigint) to authenticated;
grant execute on function public.organizer_save_table(bigint, jsonb, boolean) to authenticated;
grant execute on function public.admin_delete_tournament(bigint) to authenticated;
grant execute on function public.admin_list_users() to authenticated;

revoke all on function public.paypal_start_payment(uuid, bigint, text, text[]) from public, anon, authenticated;
revoke all on function public.paypal_admit_team(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.paypal_start_payment(uuid, bigint, text, text[]) to service_role;
grant execute on function public.paypal_admit_team(uuid, text, text, text) to service_role;

revoke all on function private.clean_members(text[]) from public;
revoke all on function private.assert_can_join(public.tournaments, uuid, text, text[]) from public;
revoke all on function private.owned_tournament(bigint) from public;
