alter table public.media_assets
add column if not exists sort_order integer not null default 0;

with ordered_featured as (
  select
    id,
    row_number() over (order by created_at desc, id) * 10 as next_sort_order
  from public.media_assets
  where featured = true
    and mime_type like 'image/%'
)
update public.media_assets
set sort_order = ordered_featured.next_sort_order
from ordered_featured
where public.media_assets.id = ordered_featured.id
  and public.media_assets.sort_order = 0;

create index if not exists media_assets_featured_sort_order_idx
on public.media_assets (featured, sort_order asc, created_at desc);
