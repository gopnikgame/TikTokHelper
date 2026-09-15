DO $$
BEGIN
  IF (SELECT count(*) FROM gift_catalog WHERE gift_id = '5655') <> 1 THEN
    RAISE EXCEPTION 'workspace gift rows were not merged into one catalogue item';
  END IF;
  IF (SELECT gift_name FROM gift_catalog WHERE gift_id = '5655') <> 'Rose current' THEN
    RAISE EXCEPTION 'latest gift metadata was not retained';
  END IF;
  IF (SELECT count(*) FROM sound_library_assets WHERE storage_key = 'shared.wav') <> 1 THEN
    RAISE EXCEPTION 'duplicate sound storage was not merged into one library asset';
  END IF;
  IF (SELECT count(*) FROM gift_sound_rules WHERE gift_id = '5655') <> 2 THEN
    RAISE EXCEPTION 'personal workspace mappings were not retained';
  END IF;
  IF (SELECT count(DISTINCT sound_asset_id) FROM gift_sound_rules WHERE gift_id = '5655') <> 1 THEN
    RAISE EXCEPTION 'workspace mappings were not redirected to the shared sound';
  END IF;
  IF (SELECT count(*) FROM observed_gifts WHERE gift_id = '5655') <> 2 THEN
    RAISE EXCEPTION 'legacy gift rollback rows were removed';
  END IF;
  IF (SELECT count(*) FROM sound_assets WHERE storage_key = 'shared.wav') <> 2 THEN
    RAISE EXCEPTION 'legacy sound rollback rows were removed';
  END IF;
END $$;

INSERT INTO gift_sound_rules (workspace_id, gift_id, sound_asset_id, is_enabled)
VALUES ('primary', '6247', '00000000-0000-4000-8000-000000000201', true);

DO $$
BEGIN
  BEGIN
    DELETE FROM sound_library_assets WHERE id = '00000000-0000-4000-8000-000000000201';
    RAISE EXCEPTION 'referenced shared sound was deleted';
  EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
    NULL;
  END;
END $$;
