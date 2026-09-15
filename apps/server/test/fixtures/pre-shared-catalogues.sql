INSERT INTO workspaces (id, display_name) VALUES
  ('primary', 'Primary'),
  ('second', 'Second');

INSERT INTO observed_gifts (
  workspace_id, gift_id, gift_name, image_url, diamond_count, first_seen_at, last_seen_at
) VALUES
  ('primary', '5655', 'Rose old', 'https://cdn.example/rose-old.png', 1, now() - interval '2 days', now() - interval '1 day'),
  ('second', '5655', 'Rose current', 'https://cdn.example/rose.png', 2, now() - interval '1 day', now());

INSERT INTO sound_assets (
  id, workspace_id, storage_key, display_name, mime_type, created_at
) VALUES
  ('00000000-0000-4000-8000-000000000201', 'primary', 'shared.wav', 'Shared sound', 'audio/wav', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000202', 'second', 'shared.wav', 'Shared sound duplicate', 'audio/wav', now());

INSERT INTO gift_sound_rules (
  workspace_id, gift_id, sound_asset_id, is_enabled
) VALUES
  ('primary', '5655', '00000000-0000-4000-8000-000000000201', true),
  ('second', '5655', '00000000-0000-4000-8000-000000000202', true);
