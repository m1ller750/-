-- TurniRUM wallets and prizes.
-- A paid tournament settles when the organizer finishes it: 10% of the PayPal entry fees goes to the platform
-- wallet, the prize pool is paid to the winners' PayPal accounts (PayPal Payouts, sent by the `api` Edge
-- Function) and the rest goes to the organizer's wallet. Wallet money is withdrawn to PayPal.
-- Every entry fee is now a verified PayPal payment, so offline "paid" marks are gone.

-- ---------------------------------------------------------------- helpers --

-- Prize places are shares of the prize pool: 1–10 places, each 1–100 %, adding up to 100 %.
create or replace function private.prize_split_ok(p_split integer[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_split) between 1 and 10
                  and (select bool_and(x between 1 and 100) and sum(x) = 100 from unnest(p_split) as x), false)
$$;
revoke all on function private.prize_split_ok(integer[]) from public, anon, authenticated;
grant execute on function private.prize_split_ok(integer[]) to service_role;

-- ------------------------------------------------------------------ tables --

alter table public.tournaments
  add column prize_split integer[] not null default '{50,30,20}',
  add column fee_ack_at  timestamptz,
  add column settled_at  timestamptz,
  add constraint tournaments_prize_split check (private.prize_split_ok(prize_split));

update public.teams set is_paid = false, payment_method = null, paid_amount = 0, paid_at = null
where payment_method = 'manual';
alter table public.teams drop constraint teams_payment_method;
alter table public.teams add constraint teams_payment_method check (payment_method = 'paypal');
-- PayPal email that receives the team's prize. Not granted to anon/authenticated, so it stays private.
alter table public.teams add column prize_email text;

alter table public.payments add column prize_email text;
alter table public.payments add column paypal_fee numeric(10, 2);
alter table public.payments drop constraint payments_status;
alter table public.payments add constraint payments_status
  check (status in ('created', 'completed', 'pending', 'failed', 'refunding', 'refunded'));

update public.teams tm set prize_email = lower(p.payer_email)
from public.payments p
where p.team_id = tm.id and p.status = 'completed' and tm.prize_email is null;

-- Organizers now withdraw from their wallet instead of naming a payout email per tournament.
drop table public.tournament_payouts;

-- Money sent with PayPal Payouts: prizes to winners and withdrawals from wallets. wallet/owner_id is the wallet
-- that a withdrawal is taken from, or that gets a prize back if PayPal cannot deliver it.
create table public.payouts (
  id               bigint generated always as identity primary key,
  kind             text not null,
  wallet           text not null,
  owner_id         uuid references public.profiles (id) on delete restrict,
  requested_by     uuid references public.profiles (id) on delete set null,
  recipient_id     uuid references public.profiles (id) on delete set null,
  tournament_id    bigint references public.tournaments (id) on delete set null,
  tournament_title text not null default '',
  team_id          bigint references public.teams (id) on delete set null,
  team_name        text,
  place            integer,
  receiver_email   text not null,
  amount           numeric(12, 2) not null,
  currency         text not null default 'USD',
  status           text not null default 'queued',
  attempts         integer not null default 0,
  paypal_batch_id  text,
  paypal_item_id   text,
  paypal_fee       numeric(10, 2),
  failure_reason   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint payouts_kind check (kind in ('prize', 'withdrawal')),
  constraint payouts_wallet check (
    (wallet = 'organizer' and owner_id is not null) or (wallet = 'platform' and owner_id is null and kind = 'withdrawal')),
  constraint payouts_amount check (amount >= 0.01),
  constraint payouts_status check (status in ('queued', 'sent', 'unclaimed', 'paid', 'failed')),
  constraint payouts_email check (char_length(receiver_email) between 3 and 254)
);
create index payouts_owner_idx on public.payouts (owner_id);
create index payouts_recipient_idx on public.payouts (recipient_id);
create index payouts_tournament_idx on public.payouts (tournament_id);
create index payouts_open_idx on public.payouts (status) where status in ('queued', 'sent', 'unclaimed');

-- Wallet ledger: a wallet's balance is the sum of its entries. The platform wallet belongs to the creator.
create table public.wallet_entries (
  id               bigint generated always as identity primary key,
  wallet           text not null,
  owner_id         uuid references public.profiles (id) on delete restrict,
  amount           numeric(12, 2) not null,
  kind             text not null,
  tournament_id    bigint references public.tournaments (id) on delete set null,
  tournament_title text not null default '',
  payout_id        bigint references public.payouts (id) on delete restrict,
  note             text not null default '',
  created_at       timestamptz not null default now(),
  constraint wallet_entries_wallet check (
    (wallet = 'organizer' and owner_id is not null) or (wallet = 'platform' and owner_id is null)),
  constraint wallet_entries_kind check (kind in (
    'platform_fee', 'organizer_income', 'unpaid_prize', 'prize_returned', 'withdrawal', 'withdrawal_returned')),
  constraint wallet_entries_amount check (amount <> 0)
);
create index wallet_entries_wallet_idx on public.wallet_entries (wallet, owner_id);
create index wallet_entries_payout_idx on public.wallet_entries (payout_id);
create index wallet_entries_tournament_idx on public.wallet_entries (tournament_id);

alter table public.payouts enable row level security;
alter table public.wallet_entries enable row level security;

create policy "Wallet owners, winners and the creator read payouts" on public.payouts
  for select to authenticated using (
    owner_id = (select auth.uid())
    or recipient_id = (select auth.uid())
    or (select private.my_role()) = 'creator');

create policy "Wallet owners and the creator read wallet entries" on public.wallet_entries
  for select to authenticated using (
    owner_id = (select auth.uid())
    or (select private.my_role()) = 'creator');

revoke all on public.payouts, public.wallet_entries from anon;
revoke insert, update, delete, truncate on public.payouts, public.wallet_entries from authenticated;

-- Collected money now means verified PayPal payments only.
create or replace view public.tournament_overview with (security_invoker = on) as
select t.id, t.organizer_id, t.title, t.game, t.description, t.format, t.city, t.start_at,
       t.max_teams, t.team_size, t.is_paid, t.entry_fee, t.prize_percent, t.prize_note, t.status, t.created_at,
       p.full_name as organizer_name,
       p.username  as organizer_username,
       coalesce(s.team_count, 0)::integer        as team_count,
       coalesce(s.paid_count, 0)::integer        as paid_count,
       coalesce(s.collected, 0)::numeric(12, 2)  as collected,
       t.prize_split, t.fee_ack_at, t.settled_at
from public.tournaments t
join public.profiles p on p.id = t.organizer_id
left join lateral (
  select count(*)                                                      as team_count,
         count(*) filter (where tm.payment_method = 'paypal')          as paid_count,
         sum(tm.paid_amount) filter (where tm.payment_method = 'paypal') as collected
  from public.teams tm
  where tm.tournament_id = t.id
) s on true;

-- ------------------------------------------------------------- settlement --

create or replace function private.wallet_balance(p_wallet text, p_owner uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.wallet_entries
  where wallet = p_wallet and owner_id is not distinct from p_owner
$$;
revoke all on function private.wallet_balance(text, uuid) from public, anon, authenticated;

-- What finishing a paid tournament pays out, in cents. The preview and the settlement both use it, so the
-- organizer sees exactly what will happen. The platform fee (10%, as PLATFORM_FEE in site/js/config.js) and the
-- prize pool are rounded half up and the organizer gets the rest; each prize place gets its share rounded down
-- and 1st place also gets the leftover cents. Teams are ranked like the public standings.
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
    select row_number() over (order by tm.points desc, tm.score_for - tm.score_against desc, tm.score_for desc,
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
revoke all on function private.settlement_plan(public.tournaments) from public, anon, authenticated;

-- Read-only preview for the organizer's "Finish & pay prizes" dialog.
create or replace function public.settlement_preview(p_tournament_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t    public.tournaments;
  v_plan jsonb;
begin
  select * into v_t from public.tournaments where id = p_tournament_id;
  if not found or v_t.organizer_id is distinct from (select auth.uid()) then
    raise exception 'Tournament not found.';
  end if;
  v_plan := private.settlement_plan(v_t);
  -- The winners' PayPal emails stay private; the organizer only sees whether one is on file.
  return jsonb_set(v_plan, '{places}', (
    select coalesce(jsonb_agg(((p - 'prize_email') - 'captain_id')
                              || jsonb_build_object('has_email', p ->> 'prize_email' is not null)
                              order by (p ->> 'place')::integer), '[]')
    from jsonb_array_elements(v_plan -> 'places') as p));
end;
$$;

-- Finishes a paid tournament (service role): the platform fee and the organizer's income go to the wallets and
-- the prizes are queued as payouts for the Edge Function to send. A prize that cannot be sent automatically
-- (nobody finished in that place, or the team has no PayPal email) goes to the organizer's wallet instead.
create or replace function public.settle_tournament(p_tournament_id bigint, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t      public.tournaments;
  v_plan   jsonb;
  v_place  jsonb;
  v_amount numeric;
  v_ids    bigint[] := '{}';
  v_id     bigint;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found or v_t.organizer_id is distinct from p_user_id then
    raise exception 'Tournament not found.';
  end if;
  if v_t.settled_at is not null then
    raise exception 'This tournament is already finished and its prizes were distributed.';
  end if;
  if not v_t.is_paid then
    raise exception 'Free tournaments have no prize money to distribute.';
  end if;
  if exists (select 1 from public.payments where tournament_id = v_t.id and status = 'refunding') then
    raise exception 'A refund is in progress. Please try again in a minute.';
  end if;

  v_plan := private.settlement_plan(v_t);
  update public.tournaments set status = 'finished', settled_at = now() where id = v_t.id;

  for v_place in select * from jsonb_array_elements(v_plan -> 'places') loop
    v_amount := (v_place ->> 'amount')::bigint / 100.0;
    continue when v_amount <= 0;
    if v_place ->> 'team_id' is not null and v_place ->> 'prize_email' is not null then
      insert into public.payouts (kind, wallet, owner_id, requested_by, recipient_id, tournament_id, tournament_title,
                                  team_id, team_name, place, receiver_email, amount)
      values ('prize', 'organizer', v_t.organizer_id, p_user_id, (v_place ->> 'captain_id')::uuid, v_t.id, v_t.title,
              (v_place ->> 'team_id')::bigint, v_place ->> 'team_name', (v_place ->> 'place')::integer,
              v_place ->> 'prize_email', v_amount)
      returning id into v_id;
      v_ids := v_ids || v_id;
    else
      insert into public.wallet_entries (wallet, owner_id, amount, kind, tournament_id, tournament_title, note)
      values ('organizer', v_t.organizer_id, v_amount, 'unpaid_prize', v_t.id, v_t.title,
              case when v_place ->> 'team_id' is null
                   then format('Prize for place %s: no team finished there', v_place ->> 'place')
                   else format('Prize for place %s (%s): no PayPal email on file, pay the winner directly',
                               v_place ->> 'place', v_place ->> 'team_name') end);
    end if;
  end loop;

  if (v_plan ->> 'platform')::bigint > 0 then
    insert into public.wallet_entries (wallet, amount, kind, tournament_id, tournament_title, note)
    values ('platform', (v_plan ->> 'platform')::bigint / 100.0, 'platform_fee', v_t.id, v_t.title, '10% platform fee');
  end if;
  if (v_plan ->> 'organizer')::bigint > 0 then
    insert into public.wallet_entries (wallet, owner_id, amount, kind, tournament_id, tournament_title, note)
    values ('organizer', v_t.organizer_id, (v_plan ->> 'organizer')::bigint / 100.0, 'organizer_income', v_t.id,
            v_t.title, 'Your share of the entry fees');
  end if;
  return (v_plan - 'places') || jsonb_build_object('payout_ids', to_jsonb(v_ids));
end;
$$;

-- Records what PayPal said about a payout (service role). p_attempt is the attempt whose request PayPal answered,
-- so the next try uses new ids; it stays null when PayPal did not answer, so a retry repeats the same request.
-- A failed payout gives the money back: a withdrawal to its wallet, a prize to the organizer's wallet.
create or replace function public.payout_update(
  p_payout_id bigint, p_status text, p_attempt integer default null, p_batch_id text default null,
  p_item_id text default null, p_reason text default null, p_fee numeric default null)
returns public.payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.payouts;
begin
  if p_status not in ('queued', 'sent', 'unclaimed', 'paid', 'failed') then
    raise exception 'Unknown payout status.';
  end if;
  select * into v_p from public.payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Payout not found.';
  end if;
  if v_p.status in ('paid', 'failed') then
    return v_p;
  end if;
  update public.payouts set
    status = p_status,
    attempts = greatest(attempts, coalesce(p_attempt, 0)),
    paypal_batch_id = coalesce(p_batch_id, paypal_batch_id),
    paypal_item_id = coalesce(p_item_id, paypal_item_id),
    paypal_fee = coalesce(p_fee, paypal_fee),
    failure_reason = case when p_status in ('queued', 'failed') then left(p_reason, 300) end,
    updated_at = now()
  where id = v_p.id
  returning * into v_p;

  if p_status = 'failed' then
    insert into public.wallet_entries (wallet, owner_id, amount, kind, tournament_id, tournament_title, payout_id, note)
    values (v_p.wallet, v_p.owner_id, v_p.amount,
            case v_p.kind when 'withdrawal' then 'withdrawal_returned' else 'prize_returned' end,
            v_p.tournament_id, v_p.tournament_title, v_p.id,
            case v_p.kind
              when 'withdrawal' then format('Withdrawal to %s failed, the money is back', v_p.receiver_email)
              else format('Prize for place %s (%s) could not be sent to %s, pay the winner directly',
                          v_p.place, v_p.team_name, v_p.receiver_email) end);
  end if;
  return v_p;
end;
$$;

-- Takes money out of a wallet for a PayPal withdrawal (service role); the Edge Function then sends it.
create or replace function public.start_withdrawal(p_user_id uuid, p_wallet text, p_amount numeric, p_email text)
returns public.payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role    text;
  v_owner   uuid;
  v_amount  numeric := round(coalesce(p_amount, 0), 2);
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_balance numeric;
  v_p       public.payouts;
begin
  select role into v_role from public.profiles where id = p_user_id;
  if p_wallet = 'platform' and v_role = 'creator' then
    v_owner := null;
  elsif p_wallet = 'organizer' and v_role = 'organizer' then
    v_owner := p_user_id;
  else
    raise exception 'This wallet is not yours.';
  end if;
  if char_length(v_email) > 254 or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter the PayPal email that should receive the money.';
  end if;
  if v_amount < 1 then
    raise exception 'The minimum withdrawal is $1.';
  end if;
  -- One withdrawal at a time per wallet, so two requests cannot both pass the balance check.
  perform pg_advisory_xact_lock(hashtextextended('turnirum-wallet:' || p_wallet || ':' || coalesce(v_owner::text, ''), 0));
  v_balance := private.wallet_balance(p_wallet, v_owner);
  if v_amount > v_balance then
    if v_balance < 1 then
      raise exception 'There is not enough money in this wallet yet.';
    end if;
    raise exception 'You can withdraw at most $%.', to_char(v_balance, 'FM999999990.00');
  end if;
  insert into public.payouts (kind, wallet, owner_id, requested_by, receiver_email, amount)
  values ('withdrawal', p_wallet, v_owner, p_user_id, v_email, v_amount)
  returning * into v_p;
  insert into public.wallet_entries (wallet, owner_id, amount, kind, payout_id, note)
  values (p_wallet, v_owner, -v_amount, 'withdrawal', v_p.id, 'Withdrawal to ' || v_email);
  return v_p;
end;
$$;

-- ------------------------------------------------------------------ refunds --

-- The organizer refunds and removes a PayPal team (service role): checks it and marks the payment as refunding.
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

-- Ends a refund (service role): removes the team if PayPal refunded the money, otherwise keeps it as paid.
create or replace function public.refund_team_finish(p_payment_id uuid, p_refunded boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.payments;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if not found or v_p.status <> 'refunding' then
    return;
  end if;
  if p_refunded then
    update public.payments set status = 'refunded', failure_reason = coalesce(p_reason, 'Refunded by the organizer.'),
                               updated_at = now()
    where id = v_p.id;
    delete from public.teams where id = v_p.team_id;
  else
    update public.payments set status = 'completed', failure_reason = left(p_reason, 300), updated_at = now()
    where id = v_p.id;
  end if;
end;
$$;

-- The creator deletes a tournament (service role). An unsettled paid tournament is refunded first: registration
-- closes and its PayPal payments are marked as refunding; the Edge Function refunds them, then deletes it.
create or replace function public.delete_tournament_start(p_tournament_id bigint, p_user_id uuid)
returns setof public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.tournaments;
begin
  if (select role from public.profiles where id = p_user_id) is distinct from 'creator' then
    raise exception 'Only the platform creator can delete tournaments.';
  end if;
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Tournament not found.';
  end if;
  if v_t.settled_at is not null or not v_t.is_paid then
    return;
  end if;
  if v_t.status = 'registration' then
    update public.tournaments set status = 'active' where id = v_t.id;
  end if;
  return query
    update public.payments set status = 'refunding', updated_at = now()
    where tournament_id = v_t.id and status = 'completed' and paypal_capture_id is not null
    returning *;
end;
$$;

drop function public.admin_delete_tournament(bigint);

-- --------------------------------------------------------- organizer RPCs --

drop function public.save_tournament(bigint, jsonb, text);

create or replace function public.save_tournament(p_id bigint, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_t       public.tournaments;
  v_id      bigint;
  v_is_paid boolean := coalesce((p_data ->> 'is_paid')::boolean, false);
  v_fee     numeric := case when v_is_paid then round(coalesce((p_data ->> 'entry_fee')::numeric, 0), 2) else 0 end;
  v_prize   integer := coalesce((p_data ->> 'prize_percent')::integer, 60);
  v_split   integer[] := case when jsonb_typeof(p_data -> 'prize_split') = 'array'
                              then array(select jsonb_array_elements_text(p_data -> 'prize_split')::integer)
                              else '{50,30,20}' end;
  v_ack     boolean := coalesce((p_data ->> 'fee_ack')::boolean, false);
  v_format  text := coalesce(p_data ->> 'format', 'online');
  v_start   timestamptz := (p_data ->> 'start_at')::timestamptz;
  v_max     integer := (p_data ->> 'max_teams')::integer;
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
  if v_prize not between 0 and 90 then
    raise exception 'The prize pool share must be between 0%% and 90%%.';
  end if;
  if v_is_paid and (v_fee < 1 or v_fee > 10000) then
    raise exception 'The entry fee must be between $1 and $10,000.';
  end if;
  if not private.prize_split_ok(v_split) then
    if v_is_paid then
      raise exception 'Prize places must add up to 100%% (1 to 10 places).';
    end if;
    v_split := '{50,30,20}';
  end if;

  if p_id is not null then
    v_t := private.owned_tournament(p_id);
    if v_t.settled_at is not null then
      raise exception 'This tournament is finished and its prizes were distributed, so it can no longer be edited.';
    end if;
    if v_max < (select count(*) from public.teams where tournament_id = p_id) then
      raise exception 'More teams are already registered than the new limit allows.';
    end if;
    if exists (select 1 from public.teams where tournament_id = p_id and payment_method = 'paypal')
       and (not v_is_paid or v_fee <> v_t.entry_fee or v_prize <> v_t.prize_percent
            or v_split is distinct from v_t.prize_split) then
      raise exception 'Teams have already paid, so the entry fee and the prizes can no longer be changed.';
    end if;
  end if;
  if v_is_paid and not v_ack and (p_id is null or v_t.fee_ack_at is null) then
    raise exception 'Please confirm that TurniRUM keeps 10%% of the entry fees.';
  end if;

  if p_id is null then
    if v_start < now() - interval '1 day' then
      raise exception 'The start date cannot be in the past.';
    end if;
    insert into public.tournaments (organizer_id, title, game, description, format, city, start_at, max_teams,
                                    team_size, is_paid, entry_fee, prize_percent, prize_split, prize_note, fee_ack_at)
    values (v_uid, btrim(p_data ->> 'title'), btrim(p_data ->> 'game'), coalesce(p_data ->> 'description', ''),
            v_format, case when v_format = 'offline' then btrim(coalesce(p_data ->> 'city', '')) else '' end,
            v_start, v_max, (p_data ->> 'team_size')::integer, v_is_paid, v_fee, v_prize, v_split,
            btrim(coalesce(p_data ->> 'prize_note', '')), case when v_is_paid then now() end)
    returning id into v_id;
  else
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
      entry_fee = v_fee,
      prize_percent = v_prize,
      prize_split = v_split,
      prize_note = btrim(coalesce(p_data ->> 'prize_note', '')),
      fee_ack_at = case when v_is_paid then coalesce(fee_ack_at, now()) else fee_ack_at end
    where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;

-- Paid tournaments finish through the Edge Function, which settles them and sends the prizes.
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
  if p_status = 'finished' and v_t.is_paid then
    raise exception 'Use “Finish & pay prizes” to finish a paid tournament.';
  end if;
  update public.tournaments set status = p_status where id = p_tournament_id;
end;
$$;

drop function public.organizer_add_team(bigint, text, text[], boolean);

-- Teams the organizer adds are invited without an entry fee.
create or replace function public.organizer_add_team(p_tournament_id bigint, p_name text, p_members text[])
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t       public.tournaments := private.owned_tournament(p_tournament_id);
  v_members text[] := private.clean_members(p_members);
  v_id      bigint;
begin
  if v_t.settled_at is not null then
    raise exception 'The prizes were already distributed, so the results are final.';
  end if;
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
  insert into public.teams (tournament_id, name, members)
  values (v_t.id, btrim(p_name), v_members)
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
  v_team public.teams;
  v_t    public.tournaments;
begin
  select * into v_team from public.teams where id = p_team_id;
  v_t := private.owned_tournament(v_team.tournament_id);
  if v_t.settled_at is not null then
    raise exception 'The prizes were already distributed, so the results are final.';
  end if;
  if v_team.payment_method = 'paypal' then
    raise exception 'This team paid with PayPal. Use “Refund & remove” to give the money back.';
  end if;
  delete from public.teams where id = p_team_id;
end;
$$;

-- p_rows: [{id, name, members[], wins, draws, losses, score_for, score_against, points}]
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

-- ------------------------------------------------- PayPal (service role) --

drop function public.paypal_start_payment(uuid, bigint, text, text[]);

-- Validates a paid registration and records the pending payment before the PayPal order is created.
-- p_prize_email is optional: without it the prize goes to the PayPal payer, or else to the account email.
create or replace function public.paypal_start_payment(
  p_user_id uuid, p_tournament_id bigint, p_name text, p_members text[], p_prize_email text default null)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t       public.tournaments;
  v_members text[] := private.clean_members(p_members);
  v_email   text := nullif(lower(btrim(coalesce(p_prize_email, ''))), '');
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
  if v_email is not null and (char_length(v_email) > 254 or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'Enter a valid PayPal email for the prize, or leave it empty.';
  end if;
  insert into public.payments (tournament_id, tournament_title, user_id, team_name, members, amount, currency, prize_email)
  values (v_t.id, v_t.title, p_user_id, btrim(p_name), v_members, v_t.entry_fee, 'USD', v_email)
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
                            paid_at, paypal_order_id, paypal_capture_id, prize_email)
  values (v_t.id, v_p.user_id, v_p.team_name, v_p.members, true, 'paypal', v_p.amount, now(),
          v_p.paypal_order_id, p_capture_id,
          coalesce(v_p.prize_email, nullif(lower(btrim(p_payer_email)), ''),
                   (select lower(u.email) from auth.users u where u.id = v_p.user_id)))
  returning id into v_team;
  update public.payments set status = 'completed', team_id = v_team, paypal_capture_id = p_capture_id,
                             payer_email = p_payer_email, payer_name = p_payer_name, updated_at = now()
  where id = p_payment_id;
  return v_team;
end;
$$;

-- ---------------------------------------------------------------- grants --

revoke all on function public.settlement_preview(bigint) from public, anon;
revoke all on function public.save_tournament(bigint, jsonb) from public, anon;
revoke all on function public.organizer_add_team(bigint, text, text[]) from public, anon;
grant execute on function public.settlement_preview(bigint) to authenticated;
grant execute on function public.save_tournament(bigint, jsonb) to authenticated;
grant execute on function public.organizer_add_team(bigint, text, text[]) to authenticated;

revoke all on function public.paypal_start_payment(uuid, bigint, text, text[], text) from public, anon, authenticated;
revoke all on function public.settle_tournament(bigint, uuid) from public, anon, authenticated;
revoke all on function public.payout_update(bigint, text, integer, text, text, text, numeric) from public, anon, authenticated;
revoke all on function public.start_withdrawal(uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.refund_team_start(bigint, uuid) from public, anon, authenticated;
revoke all on function public.refund_team_finish(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.delete_tournament_start(bigint, uuid) from public, anon, authenticated;
grant execute on function public.paypal_start_payment(uuid, bigint, text, text[], text) to service_role;
grant execute on function public.settle_tournament(bigint, uuid) to service_role;
grant execute on function public.payout_update(bigint, text, integer, text, text, text, numeric) to service_role;
grant execute on function public.start_withdrawal(uuid, text, numeric, text) to service_role;
grant execute on function public.refund_team_start(bigint, uuid) to service_role;
grant execute on function public.refund_team_finish(uuid, boolean, text) to service_role;
grant execute on function public.delete_tournament_start(bigint, uuid) to service_role;
