-- The tournament form also sets the preferred bracket format (empty = the AI decides).
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
  v_bracket text := nullif(btrim(coalesce(p_data ->> 'bracket_format', '')), '');
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
  if v_bracket is not null and v_bracket not in ('single_elimination', 'double_elimination', 'round_robin', 'groups_playoffs') then
    raise exception 'Unknown bracket format.';
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
                                    team_size, is_paid, entry_fee, prize_percent, prize_split, prize_note, fee_ack_at,
                                    bracket_format)
    values (v_uid, btrim(p_data ->> 'title'), btrim(p_data ->> 'game'), coalesce(p_data ->> 'description', ''),
            v_format, case when v_format = 'offline' then btrim(coalesce(p_data ->> 'city', '')) else '' end,
            v_start, v_max, (p_data ->> 'team_size')::integer, v_is_paid, v_fee, v_prize, v_split,
            btrim(coalesce(p_data ->> 'prize_note', '')), case when v_is_paid then now() end, v_bracket)
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
      fee_ack_at = case when v_is_paid then coalesce(fee_ack_at, now()) else fee_ack_at end,
      -- Once the bracket is built its format stays.
      bracket_format = case when exists (select 1 from public.matches where tournament_id = p_id) then bracket_format
                            else v_bracket end
    where id = p_id;
    v_id := p_id;
  end if;
  return v_id;
end;
$$;
