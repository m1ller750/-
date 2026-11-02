-- TurniRUM brackets, AI planning, notifications and the team finder.
-- The `api` Edge Function plans brackets with Gemini and builds them with a deterministic engine (engine.js);
-- this migration stores the matches, the players' votes to move a match, in-app/email notifications and the
-- "looking for a team" cards. A pg_cron job calls the function every 10 minutes for reminders and emails.

-- ------------------------------------------------------------------ tables --

alter table public.tournaments
  add column bracket_format   text,
  add column bracket_settings jsonb not null default '{}',
  add column bracket_version  integer not null default 0,
  add column reminder_text    text,
  add constraint tournaments_bracket_format check (
    bracket_format in ('single_elimination', 'double_elimination', 'round_robin', 'groups_playoffs'));

-- 1st, 2nd... decided by the bracket (finals, third-place match); ranks before points in the standings.
alter table public.teams add column final_place integer check (final_place between 1 and 256);
grant select (final_place) on public.teams to anon, authenticated;

create table public.matches (
  id               bigint generated always as identity primary key,
  tournament_id    bigint not null references public.tournaments (id) on delete cascade,
  match_key        text not null,
  stage            text not null,
  group_name       text,
  round            integer not null,
  position         integer not null,
  phase            integer not null,
  label            text not null default '',
  source_a         jsonb not null,
  source_b         jsonb not null,
  team_a           bigint references public.teams (id) on delete set null,
  team_b           bigint references public.teams (id) on delete set null,
  score_a          integer,
  score_b          integer,
  winner_id        bigint references public.teams (id) on delete set null,
  loser_id         bigint references public.teams (id) on delete set null,
  status           text not null default 'pending',
  scheduled_at     timestamptz,
  reschedule_count integer not null default 0,
  updated_at       timestamptz not null default now(),
  constraint matches_key unique (tournament_id, match_key),
  constraint matches_stage check (stage in ('league', 'group', 'upper', 'lower', 'playoff', 'final', 'grand_final', 'third_place')),
  constraint matches_status check (status in ('pending', 'scheduled', 'finished', 'bye')),
  constraint matches_scores check (score_a between 0 and 999 and score_b between 0 and 999)
);
create index matches_tournament_idx on public.matches (tournament_id, phase, position);
create index matches_upcoming_idx on public.matches (scheduled_at) where status = 'scheduled';

-- A match moves when the captains of both teams ask for it.
create table public.reschedule_votes (
  match_id   bigint not null references public.matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  team_id    bigint not null references public.teams (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table public.notifications (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text not null default '',
  link         text,
  dedupe_key   text unique,
  email_status text not null default 'pending',
  email_error  text,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint notifications_kind check (kind in ('reminder', 'match', 'bracket', 'reschedule', 'invite', 'prize')),
  constraint notifications_email check (email_status in ('pending', 'sent', 'skipped', 'failed'))
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_pending_idx on public.notifications (created_at) where email_status = 'pending';

-- "Looking for a team" cards of players, shown to signed-in users in the team finder.
create table public.player_cards (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  looking    boolean not null default false,
  games      text[] not null default '{}',
  note       text not null default '',
  contact    text not null default '',
  updated_at timestamptz not null default now(),
  constraint player_cards_note check (char_length(note) <= 300),
  constraint player_cards_contact check (char_length(contact) <= 100),
  constraint player_cards_games check (cardinality(games) <= 8)
);

alter table public.matches enable row level security;
alter table public.reschedule_votes enable row level security;
alter table public.notifications enable row level security;
alter table public.player_cards enable row level security;

create policy "Matches are public" on public.matches for select to anon, authenticated using (true);
create policy "Signed-in users see reschedule votes" on public.reschedule_votes for select to authenticated using (true);
create policy "Users read their notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Signed-in users see player cards" on public.player_cards for select to authenticated using (true);

revoke insert, update, delete, truncate on public.matches, public.reschedule_votes, public.notifications,
  public.player_cards from anon, authenticated;
revoke select on public.reschedule_votes, public.notifications, public.player_cards from anon;

create or replace view public.tournament_overview with (security_invoker = on) as
select t.id, t.organizer_id, t.title, t.game, t.description, t.format, t.city, t.start_at,
       t.max_teams, t.team_size, t.is_paid, t.entry_fee, t.prize_percent, t.prize_note, t.status, t.created_at,
       p.full_name as organizer_name,
       p.username  as organizer_username,
       coalesce(s.team_count, 0)::integer        as team_count,
       coalesce(s.paid_count, 0)::integer        as paid_count,
       coalesce(s.collected, 0)::numeric(12, 2)  as collected,
       t.prize_split, t.fee_ack_at, t.settled_at, t.bracket_format, t.bracket_settings
from public.tournaments t
join public.profiles p on p.id = t.organizer_id
left join lateral (
  select count(*)                                                      as team_count,
         count(*) filter (where tm.payment_method = 'paypal')          as paid_count,
         sum(tm.paid_amount) filter (where tm.payment_method = 'paypal') as collected
  from public.teams tm
  where tm.tournament_id = t.id
) s on true;

-- Teams cannot join or leave once the bracket is built (deleting the whole tournament still works).
create or replace function private.teams_locked_by_bracket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id bigint;
begin
  if tg_op = 'DELETE' then
    v_tournament_id := old.tournament_id;
  else
    v_tournament_id := new.tournament_id;
  end if;
  if exists (select 1 from public.tournaments where id = v_tournament_id)
     and exists (select 1 from public.matches where tournament_id = v_tournament_id) then
    raise exception 'The bracket is already built. Remove it before changing the teams.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.teams_locked_by_bracket() from public, anon, authenticated;
create trigger teams_bracket_lock before insert or delete on public.teams
  for each row execute function private.teams_locked_by_bracket();

-- ------------------------------------------------------- bracket functions --

-- The places decided by the bracket come first, then points.
create or replace function private.settlement_plan(p_t public.tournaments)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_collected bigint := 0;
  v_platform  bigint;
  v_prize     bigint;
  v_n         integer := cardinality(p_t.prize_split);
  v_amounts   bigint[];
  v_ranked    jsonb;
  v_team      jsonb;
  v_places    jsonb := '[]';
  i           integer;
begin
  if p_t.is_paid then
    select coalesce(round(sum(amount) * 100), 0)::bigint into v_collected
    from public.payments where tournament_id = p_t.id and status = 'completed';
  end if;
  v_platform := (v_collected * 10 + 50) / 100;
  v_prize := (v_collected * p_t.prize_percent + 50) / 100;

  v_amounts := array_fill(0::bigint, array[v_n]);
  for i in 2..v_n loop
    v_amounts[i] := v_prize * p_t.prize_split[i] / 100;
  end loop;
  v_amounts[1] := v_prize - (select coalesce(sum(a), 0) from unnest(v_amounts) as a);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.place), '[]') into v_ranked
  from (
    select row_number() over (order by tm.final_place nulls last, tm.points desc, tm.score_for - tm.score_against desc, tm.score_for desc,
                                       tm.wins desc, tm.name_key, tm.id) as place,
           tm.id as team_id, tm.name as team_name, tm.prize_email, tm.captain_id
    from public.teams tm
    where tm.tournament_id = p_t.id
    order by place
    limit v_n
  ) r;

  for i in 1..v_n loop
    v_team := v_ranked -> (i - 1);
    v_places := v_places || jsonb_build_array(jsonb_build_object(
      'place', i, 'percent', p_t.prize_split[i], 'amount', v_amounts[i],
      'team_id', v_team -> 'team_id', 'team_name', v_team ->> 'team_name',
      'prize_email', v_team ->> 'prize_email', 'captain_id', v_team ->> 'captain_id'));
  end loop;

  return jsonb_build_object(
    'collected', v_collected, 'platform', v_platform, 'prize', v_prize,
    'organizer', v_collected - v_platform - v_prize, 'places', v_places);
end;
$$;

create or replace function public.refund_team_start(p_team_id bigint, p_user_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_t    public.tournaments;
  v_p    public.payments;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found then
    raise exception 'Team not found.';
  end if;
  select * into v_t from public.tournaments where id = v_team.tournament_id for update;
  if v_t.organizer_id is distinct from p_user_id then
    raise exception 'Team not found.';
  end if;
  if v_t.settled_at is not null then
    raise exception 'The prizes were already distributed, so the results are final.';
  end if;
  if exists (select 1 from public.matches where tournament_id = v_t.id) then
    raise exception 'The bracket is already built. Remove it before changing the teams.';
  end if;
  if v_team.payment_method is distinct from 'paypal' then
    raise exception 'This team did not pay with PayPal.';
  end if;
  select * into v_p from public.payments
  where team_id = v_team.id and status = 'completed' and paypal_capture_id is not null
  order by created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'The PayPal payment of this team was not found.';
  end if;
  update public.payments set status = 'refunding', updated_at = now() where id = v_p.id returning * into v_p;
  return v_p;
end;
$$;

create or replace function public.set_tournament_status(p_tournament_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments := private.owned_tournament(p_tournament_id);
begin
  if p_status not in ('registration', 'active', 'finished') then
    raise exception 'Unknown status.';
  end if;
  if v_t.settled_at is not null then
    raise exception 'The prizes were already distributed, so this tournament stays finished.';
  end if;
  if p_status = 'registration' and exists (select 1 from public.matches where tournament_id = v_t.id) then
    raise exception 'Remove the bracket before reopening registration.';
  end if;
  if p_status = 'finished' and v_t.is_paid then
    raise exception 'Use “Finish & pay prizes” to finish a paid tournament.';
  end if;
  update public.tournaments set status = p_status where id = p_tournament_id;
end;
$$;

create or replace function public.organizer_save_table(
  p_tournament_id bigint, p_rows jsonb, p_auto_points boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t       public.tournaments := private.owned_tournament(p_tournament_id);
  v_row     jsonb;
  v_team    public.teams;
  v_name    text;
  v_wins    integer;
  v_draws   integer;
  v_losses  integer;
  v_for     integer;
  v_against integer;
  v_points  integer;
  v_members text[];
begin
  if v_t.settled_at is not null then
    raise exception 'The prizes were already distributed, so the results are final.';
  end if;
  if exists (select 1 from public.matches where tournament_id = v_t.id) then
    raise exception 'The standings are calculated from the bracket results.';
  end if;
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
  end loop;

  if exists (select 1 from public.teams where tournament_id = v_t.id
             group by name_key having count(*) > 1) then
    raise exception 'Two teams cannot have the same name.';
  end if;
end;
$$;

-- Saves what the Edge Function computed with engine.js (service role). p_version guards against two saves at once.
create or replace function public.apply_bracket(
  p_tournament_id bigint, p_version integer, p_format text, p_settings jsonb, p_matches jsonb, p_stats jsonb,
  p_replace boolean, p_close_registration boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Tournament not found.';
  end if;
  if v_t.settled_at is not null then
    raise exception 'The prizes were already distributed, so the bracket is final.';
  end if;
  if v_t.bracket_version <> p_version then
    raise exception 'The bracket changed in the meantime. Please try again.';
  end if;

  if p_replace then
    delete from public.matches where tournament_id = v_t.id;
    insert into public.matches (tournament_id, match_key, stage, group_name, round, position, phase, label, source_a,
                                source_b, team_a, team_b, score_a, score_b, winner_id, loser_id, status, scheduled_at)
    select v_t.id, x.match_key, x.stage, x.group_name, x.round, x.position, x.phase, coalesce(x.label, ''), x.source_a,
           x.source_b, x.team_a, x.team_b, x.score_a, x.score_b, x.winner_id, x.loser_id, x.status, x.scheduled_at
    from jsonb_to_recordset(coalesce(p_matches, '[]')) as x(
      match_key text, stage text, group_name text, round integer, position integer, phase integer, label text,
      source_a jsonb, source_b jsonb, team_a bigint, team_b bigint, score_a integer, score_b integer, winner_id bigint,
      loser_id bigint, status text, scheduled_at timestamptz);
  else
    update public.matches m set
      team_a = x.team_a, team_b = x.team_b, score_a = x.score_a, score_b = x.score_b, winner_id = x.winner_id,
      loser_id = x.loser_id, status = x.status, scheduled_at = x.scheduled_at,
      reschedule_count = m.reschedule_count + coalesce(x.rescheduled, 0), updated_at = now()
    from jsonb_to_recordset(coalesce(p_matches, '[]')) as x(
      match_key text, team_a bigint, team_b bigint, score_a integer, score_b integer, winner_id bigint, loser_id bigint,
      status text, scheduled_at timestamptz, rescheduled integer)
    where m.tournament_id = v_t.id and m.match_key = x.match_key;
  end if;

  update public.teams tm set
    wins = x.wins, draws = x.draws, losses = x.losses, score_for = x.score_for, score_against = x.score_against,
    points = x.points, final_place = x.final_place
  from jsonb_to_recordset(coalesce(p_stats, '[]')) as x(
    id bigint, wins integer, draws integer, losses integer, score_for integer, score_against integer, points integer,
    final_place integer)
  where tm.id = x.id and tm.tournament_id = v_t.id;

  update public.tournaments set
    bracket_format = coalesce(p_format, bracket_format),
    bracket_settings = coalesce(p_settings, bracket_settings),
    bracket_version = bracket_version + 1,
    status = case when p_close_registration and status = 'registration' then 'active' else status end
  where id = v_t.id;
  return v_t.bracket_version + 1;
end;
$$;

-- A captain asks to move their match (service role). Every team in the match that has a captain must ask.
create or replace function public.cast_reschedule_vote(p_match_id bigint, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m      public.matches;
  v_team   bigint;
  v_votes  integer;
  v_needed integer;
begin
  select * into v_m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found.';
  end if;
  if v_m.status <> 'scheduled' then
    raise exception 'Only upcoming matches with both teams known can be moved.';
  end if;
  if v_m.scheduled_at is not null and v_m.scheduled_at <= now() then
    raise exception 'This match has already started.';
  end if;
  select id into v_team from public.teams where id in (v_m.team_a, v_m.team_b) and captain_id = p_user_id;
  if v_team is null then
    raise exception 'Only the captains of the two teams can ask to move this match.';
  end if;
  insert into public.reschedule_votes (match_id, user_id, team_id) values (v_m.id, p_user_id, v_team)
  on conflict do nothing;
  select count(distinct team_id) into v_votes from public.reschedule_votes where match_id = v_m.id;
  select count(*) into v_needed from public.teams where id in (v_m.team_a, v_m.team_b) and captain_id is not null;
  return jsonb_build_object('votes', v_votes, 'needed', v_needed, 'complete', v_votes >= v_needed,
                            'tournament_id', v_m.tournament_id, 'match_key', v_m.match_key);
end;
$$;

-- ------------------------------------------------- notifications, players --

create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids))
$$;

-- Emails waiting to be sent (service role). Older than two days they are not sent any more.
create or replace function public.pending_emails(p_limit integer default 40)
returns table (id bigint, email text, full_name text, kind text, title text, body text, link text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications set email_status = 'skipped', email_error = 'Too old to send.'
  where email_status = 'pending' and created_at < now() - interval '2 days';
  return query
    select n.id, u.email::text, p.full_name, n.kind, n.title, n.body, n.link
    from public.notifications n
    join auth.users u on u.id = n.user_id
    join public.profiles p on p.id = n.user_id
    where n.email_status = 'pending'
    order by n.created_at
    limit p_limit;
end;
$$;

create or replace function public.save_player_card(p_looking boolean, p_games text[], p_note text, p_contact text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_games text[] := (select coalesce(array_agg(distinct left(btrim(g), 40)), '{}')
                     from unnest(coalesce(p_games, '{}'::text[])) as g where btrim(g) <> '');
begin
  if (select private.my_role()) is distinct from 'participant' then
    raise exception 'Only player accounts have a team finder card.';
  end if;
  if cardinality(v_games) > 8 then
    raise exception 'Pick at most 8 games.';
  end if;
  if char_length(coalesce(p_note, '')) > 300 then
    raise exception 'Keep the note under 300 characters.';
  end if;
  if char_length(coalesce(p_contact, '')) > 100 then
    raise exception 'Keep the contact under 100 characters.';
  end if;
  insert into public.player_cards (user_id, looking, games, note, contact, updated_at)
  values ((select auth.uid()), coalesce(p_looking, false), v_games, btrim(coalesce(p_note, '')),
          btrim(coalesce(p_contact, '')), now())
  on conflict (user_id) do update set looking = excluded.looking, games = excluded.games, note = excluded.note,
                                      contact = excluded.contact, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------- grants --

revoke all on function public.apply_bracket(bigint, integer, text, jsonb, jsonb, jsonb, boolean, boolean) from public, anon, authenticated;
revoke all on function public.cast_reschedule_vote(bigint, uuid) from public, anon, authenticated;
revoke all on function public.pending_emails(integer) from public, anon, authenticated;
revoke all on function public.mark_notifications_read(bigint[]) from public, anon;
revoke all on function public.save_player_card(boolean, text[], text, text) from public, anon;
grant execute on function public.apply_bracket(bigint, integer, text, jsonb, jsonb, jsonb, boolean, boolean) to service_role;
grant execute on function public.cast_reschedule_vote(bigint, uuid) to service_role;
grant execute on function public.pending_emails(integer) to service_role;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;
grant execute on function public.save_player_card(boolean, text[], text, text) to authenticated;

-- ------------------------------------------------------------- reminders --

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Every 10 minutes: tournament and match reminders, and emails waiting to be sent.
select cron.schedule('turnirum-tick', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://kcumknqjdgscspxtsigg.supabase.co/functions/v1/api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_oCVCYLkmPAecBdaZ63iYpQ_eAsPi99R',
      'x-cron-secret', (select value from public.app_settings where key = 'cron_secret')),
    body := '{"action":"cron-tick"}'::jsonb,
    timeout_milliseconds := 120000)
$job$);
