-- Accounts on reserved test domains (RFC 2606/6761: example.com, *.test, *.invalid…) cannot receive mail.
-- Sending to them would only bounce and hurt the sender's reputation, so their emails are skipped.
create or replace function public.pending_emails(p_limit integer default 40)
returns table(id bigint, email text, full_name text, kind text, title text, body text, link text)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.notifications set email_status = 'skipped', email_error = 'Too old to send.'
  where email_status = 'pending' and created_at < now() - interval '2 days';
  update public.notifications n set email_status = 'skipped', email_error = 'Test address that cannot receive email.'
  from auth.users u
  where u.id = n.user_id and n.email_status = 'pending'
    and lower(split_part(u.email, '@', 2)) ~ '(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$';
  return query
    select n.id, u.email::text, p.full_name, n.kind, n.title, n.body, n.link
    from public.notifications n
    join auth.users u on u.id = n.user_id
    join public.profiles p on p.id = n.user_id
    where n.email_status = 'pending'
    order by n.created_at
    limit p_limit;
end;
$function$;
