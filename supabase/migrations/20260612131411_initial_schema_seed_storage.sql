create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'reader');
  end if;

  if not exists (select 1 from pg_type where typname = 'post_status') then
    create type public.post_status as enum ('draft', 'published', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'post_visibility') then
    create type public.post_visibility as enum ('public', 'private');
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  display_name text not null default '理哩',
  role public.user_role not null default 'reader',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  sort_order int not null default 0,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.users(id) on delete restrict,
  category_id uuid references public.categories(id) on delete set null,
  title text not null,
  slug text not null unique,
  excerpt text,
  markdown text not null default '',
  html text,
  cover_asset_id uuid,
  cover_url text,
  status public.post_status not null default 'draft',
  visibility public.post_visibility not null default 'public',
  noindex boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_publish_requires_published_at check (
    status <> 'published' or published_at is not null
  )
);

drop trigger if exists posts_set_updated_at on public.posts;
create trigger posts_set_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

create table if not exists public.post_tags (
  post_id uuid not null references public.posts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (post_id, tag_id)
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.users(id) on delete restrict,
  post_id uuid references public.posts(id) on delete set null,
  file_name text not null,
  mime_type text not null,
  bucket text not null default 'public-media',
  storage_path text not null,
  public_url text not null,
  alt text,
  caption text,
  featured boolean not null default false,
  width int,
  height int,
  size_bytes int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_assets_bucket_check check (bucket in ('public-media', 'private-media')),
  constraint media_assets_width_check check (width is null or width >= 0),
  constraint media_assets_height_check check (height is null or height >= 0),
  constraint media_assets_size_bytes_check check (size_bytes is null or size_bytes >= 0)
);

drop trigger if exists media_assets_set_updated_at on public.media_assets;
create trigger media_assets_set_updated_at
before update on public.media_assets
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'posts_cover_asset_fk'
      and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_cover_asset_fk
      foreign key (cover_asset_id)
      references public.media_assets(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists site_settings_set_updated_at on public.site_settings;
create trigger site_settings_set_updated_at
before update on public.site_settings
for each row execute function public.set_updated_at();

create index if not exists posts_status_published_at_idx
on public.posts (status, published_at desc);

create index if not exists posts_public_feed_idx
on public.posts (status, visibility, noindex, published_at desc);

create index if not exists posts_category_published_at_idx
on public.posts (category_id, published_at desc);

create index if not exists post_tags_tag_id_idx
on public.post_tags (tag_id);

create index if not exists sessions_token_hash_idx
on public.sessions (token_hash);

create index if not exists sessions_expires_at_idx
on public.sessions (expires_at);

create index if not exists media_assets_featured_idx
on public.media_assets (featured, created_at desc);

alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.posts enable row level security;
alter table public.post_tags enable row level security;
alter table public.media_assets enable row level security;
alter table public.site_settings enable row level security;

insert into public.users (username, password_hash, display_name, role)
values (
  'root',
  '$2b$12$WvkorAlNzG9HBgf8DOzru.Da8B47mDZdj35TIEf92VrzDL4G0B4Sq',
  '理哩',
  'admin'
)
on conflict (username) do update
set
  password_hash = excluded.password_hash,
  display_name = excluded.display_name,
  role = excluded.role,
  updated_at = now();

insert into public.categories (name, slug, sort_order, visible)
values
  ('游游逛逛', 'you-you-guang-guang', 10, true),
  ('卿卿我我', 'qing-qing-wo-wo', 20, true),
  ('少侠', 'shao-xia', 30, true),
  ('浮光片影', 'fu-guang-pian-ying', 40, true),
  ('但是还有书籍', 'dan-shi-hai-you-shu-ji', 50, true),
  ('四季流转', 'si-ji-liu-zhuan', 60, true),
  ('花花草草', 'hua-hua-cao-cao', 70, true),
  ('网站日记', 'wang-zhan-ri-ji', 80, true),
  ('码农小知识', 'ma-nong-xiao-zhi-shi', 90, true),
  ('未分类', 'uncategorized', 100, true)
on conflict (slug) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  visible = excluded.visible,
  updated_at = now();

insert into storage.buckets (id, name, public)
values
  ('public-media', 'public-media', true),
  ('private-media', 'private-media', false)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  updated_at = now();

drop policy if exists "Public media can be read by anyone" on storage.objects;
create policy "Public media can be read by anyone"
on storage.objects
for select
to public
using (bucket_id = 'public-media');
