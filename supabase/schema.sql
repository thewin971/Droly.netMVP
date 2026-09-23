-- ============================================================================
-- Droly — base de données Supabase
-- À coller en une seule fois dans : Supabase → SQL Editor → New query → Run.
-- Le script peut être relancé sans risque (il ne recrée pas ce qui existe).
-- ============================================================================

-- 1) Abonnements : une ligne par client, remplie UNIQUEMENT par le serveur
--    (fonctions Vercel) à partir des informations de Stripe.
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text,
  status                 text,          -- active, trialing, past_due, canceled, incomplete…
  price_id               text,
  current_period_end     timestamptz,   -- date de la prochaine facture / fin d'accès
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);

-- Mode Stripe (test ou réel) de l'abonnement : un abonnement de TEST ne doit
-- jamais donner accès une fois le site passé en paiements réels.
alter table public.subscriptions add column if not exists livemode boolean;

alter table public.subscriptions enable row level security;

-- Un client connecté peut LIRE son propre abonnement, rien d'autre.
-- Aucune règle d'écriture : seul le serveur (clé secrète) peut modifier.
drop policy if exists "Lire son abonnement" on public.subscriptions;
create policy "Lire son abonnement"
  on public.subscriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);


-- 2) Vidéos générées : une ligne par vidéo, créée par le serveur après
--    génération. Le client peut lire et supprimer les siennes.
create table if not exists public.videos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text,
  storage_path  text not null,          -- chemin du fichier dans le stockage "videos"
  created_at    timestamptz not null default now()
);

create index if not exists videos_user_created_idx
  on public.videos (user_id, created_at desc);

-- Type de vidéo : 'travelling' (plan drone, 5 s) ou 'tour' (tour à 360°, 10 s).
alter table public.videos add column if not exists kind text not null default 'travelling';

alter table public.videos enable row level security;

drop policy if exists "Lire ses videos" on public.videos;
create policy "Lire ses videos"
  on public.videos for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Supprimer ses videos" on public.videos;
create policy "Supprimer ses videos"
  on public.videos for delete
  to authenticated
  using ((select auth.uid()) = user_id);


-- 3) Registre des générations : une ligne par vidéo demandée au générateur, que le
--    client NE PEUT PAS effacer. C'est lui qui sert à compter les limites
--    (par jour / par mois) : supprimer une vidéo de "Mes vidéos" ne rend donc
--    pas de crédit. Les générations échouées ne sont pas comptées.
create table if not exists public.generations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  status          text not null default 'reserved',  -- reserved, pending, finalizing, succeeded, failed
  runway_task_id  text,
  title           text,
  video_id        uuid,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists generations_user_created_idx
  on public.generations (user_id, created_at desc);

-- Type de vidéo demandée : 'travelling' ou 'tour' (les tours à 360° ont leur propre limite).
alter table public.generations add column if not exists kind text not null default 'travelling';

alter table public.generations enable row level security;

drop policy if exists "Lire ses generations" on public.generations;
create policy "Lire ses generations"
  on public.generations for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Réserve une génération en respectant les limites, de façon atomique :
-- même 50 demandes envoyées en même temps ne peuvent pas dépasser la limite.
-- Les tours à 360° comptent dans la limite générale ET dans leur propre limite
-- (p_tour_monthly, sur 30 jours), car ils coûtent plus cher à fabriquer.
-- (L'ancienne version de la fonction, sans type de vidéo, est remplacée.)
drop function if exists public.reserve_generation(uuid, text, int, int);

create or replace function public.reserve_generation(
  p_user uuid, p_title text, p_daily int, p_monthly int,
  p_kind text default 'travelling', p_tour_monthly int default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind      text := case when p_kind = 'tour' then 'tour' else 'travelling' end;
  day_count   int;
  month_count int;
  tour_count  int;
  new_id      uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  select count(*) into day_count from public.generations
   where user_id = p_user and status <> 'failed'
     and created_at > now() - interval '24 hours';
  if p_daily > 0 and day_count >= p_daily then
    return jsonb_build_object('error', 'daily_limit');
  end if;

  select count(*) into month_count from public.generations
   where user_id = p_user and status <> 'failed'
     and created_at > now() - interval '30 days';
  if p_monthly > 0 and month_count >= p_monthly then
    return jsonb_build_object('error', 'monthly_limit');
  end if;

  if v_kind = 'tour' and p_tour_monthly > 0 then
    select count(*) into tour_count from public.generations
     where user_id = p_user and kind = 'tour' and status <> 'failed'
       and created_at > now() - interval '30 days';
    if tour_count >= p_tour_monthly then
      return jsonb_build_object('error', 'tour_limit');
    end if;
  end if;

  insert into public.generations (user_id, title, kind) values (p_user, p_title, v_kind)
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end;
$$;

-- Réserve la finalisation d'une vidéo terminée à un seul appel à la fois
-- (ou reprend une finalisation bloquée depuis plus de 3 minutes).
create or replace function public.claim_generation(p_id uuid)
returns setof public.generations
language sql
security definer
set search_path = public
as $$
  update public.generations
     set status = 'finalizing', updated_at = now()
   where id = p_id
     and (status = 'pending'
          or (status = 'finalizing' and updated_at < now() - interval '3 minutes'))
  returning *;
$$;

-- Ces fonctions sont réservées au serveur (clé secrète), jamais aux visiteurs.
revoke all on function public.reserve_generation(uuid, text, int, int, text, int) from public, anon, authenticated;
revoke all on function public.claim_generation(uuid) from public, anon, authenticated;
grant execute on function public.reserve_generation(uuid, text, int, int, text, int) to service_role;
grant execute on function public.claim_generation(uuid) to service_role;


-- 4) Stockage des fichiers vidéo (privé : jamais accessible sans être connecté).
--    Chaque fichier est rangé dans un dossier au nom de son propriétaire :
--    videos/<id-du-client>/<id-de-la-video>.mp4
insert into storage.buckets (id, name, public)
values ('videos', 'videos', false)
on conflict (id) do nothing;

drop policy if exists "Lire ses fichiers video" on storage.objects;
create policy "Lire ses fichiers video"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Supprimer ses fichiers video" on storage.objects;
create policy "Supprimer ses fichiers video"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
