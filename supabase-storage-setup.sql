-- Rulează o singură dată în Supabase SQL Editor.
-- PDF-urile rămân private și fiecare utilizator își poate accesa doar folderul.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'subject-files',
  'subject-files',
  false,
  52428800,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can view own subject files" on storage.objects;
drop policy if exists "Users can upload own subject files" on storage.objects;
drop policy if exists "Users can update own subject files" on storage.objects;
drop policy if exists "Users can delete own subject files" on storage.objects;
drop policy if exists "Itera subject files" on storage.objects;

create policy "Itera subject files"
on storage.objects for all
to authenticated
using (
  bucket_id = 'subject-files'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'subject-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);
