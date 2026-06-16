-- Music tracks: mirrors the local SQLite schema so the studio is Vercel-ready.
-- local_id is the SQLite primary key, used as the upsert conflict target.
create table if not exists public.music_tracks (
    id           bigserial primary key,
    local_id     bigint unique,
    title        text,
    prompt       text not null,
    negative     text default '',
    duration     real,
    model        text,
    guidance     real,
    temperature  real,
    seed         bigint,
    audio_url    text,
    bpm          real,
    musical_key  text,
    tags         text default '',
    favorite     int default 0,
    rating       int default 0,
    collection   text default 'All Tracks',
    created_at   timestamptz default now()
);

create index if not exists idx_music_created on public.music_tracks(created_at desc);
create index if not exists idx_music_fav on public.music_tracks(favorite);
create index if not exists idx_music_collection on public.music_tracks(collection);
