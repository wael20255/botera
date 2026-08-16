-- ============================================================================
-- Botera — message attachments: images & voice notes (run AFTER
-- 03-register-transaction.sql)
-- ============================================================================
-- What this adds:
--   1. messages.attachment_url / messages.attachment_type — nullable, so
--      every existing text-only message is completely unaffected.
--   2. A public storage bucket "message-attachments" to hold the uploaded
--      files, with a simple "must be logged in" upload policy.
-- ============================================================================

alter table public.messages add column if not exists attachment_url text;
alter table public.messages add column if not exists attachment_type text check (attachment_type in ('image', 'audio', 'file'));

-- Public bucket: images/voice notes are readable by URL so they can be
-- shown inline (an <img>/<audio> tag) without generating a signed URL on
-- every render. Uploads themselves stay restricted below.
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', true)
on conflict (id) do nothing;

-- Anyone can read a file once it's uploaded (the bucket is public content
-- meant to be shown to the customer, same idea as a public product photo).
drop policy if exists "public read - message-attachments" on storage.objects;
create policy "public read - message-attachments" on storage.objects
  for select using (bucket_id = 'message-attachments');

-- Any logged-in user may upload into this bucket. The app itself writes
-- into a "{company_id}/{conversation_id}/..." folder for organization, but
-- that's not enforced here at the database level — this project's actual
-- deployed schema doesn't have a shared helper function we can safely
-- assume exists (see the messages/conversations column mismatches found
-- earlier), so this stays deliberately simple rather than reference
-- something that might not resolve. The bucket is public-read regardless,
-- so this only gates who can write, not who can see what's already there.
drop policy if exists "authenticated can upload - message-attachments" on storage.objects;
create policy "authenticated can upload - message-attachments" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'message-attachments');
