-- Rulează o singură dată în Supabase SQL Editor.
-- PDF-urile rămân private și fiecare utilizator își poate accesa doar folderul.

insert into storage.buckets (id, name, public)
values ('subject-files', 'subject-files', false)
on conflict (id) do update set public = false;

drop policy if exists "Users can view own subject files" on storage.objects;
drop policy if exists "Users can upload own subject files" on storage.objects;
drop policy if exists "Users can update own subject files" on storage.objects;
drop policy if exists "Users can delete own subject files" on storage.objects;

create policy "Users can view own subject files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'subject-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can upload own subject files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'subject-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can update own subject files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'subject-files'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'subject-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete own subject files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'subject-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);
