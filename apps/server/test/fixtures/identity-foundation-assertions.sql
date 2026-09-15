DO $$
BEGIN
  IF (SELECT count(*) FROM workspaces WHERE id = 'primary') <> 1 THEN
    RAISE EXCEPTION 'existing primary workspace was not preserved';
  END IF;
  IF (SELECT count(*) FROM channels WHERE workspace_id = 'primary') <> 1 THEN
    RAISE EXCEPTION 'existing primary channel was not preserved';
  END IF;
  IF (SELECT count(*) FROM workspace_memberships) <> 0 THEN
    RAISE EXCEPTION 'migration implicitly claimed the primary workspace';
  END IF;
END $$;

INSERT INTO users (
  id, identity_provider, identity_subject, display_name, last_login_at
) VALUES (
  '00000000-0000-4000-8000-000000000001', 'vline',
  '00000000-0000-4000-8000-000000000101', 'Migration test user', now()
);

INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES (
  'primary', '00000000-0000-4000-8000-000000000001', 'owner'
);

INSERT INTO app_sessions (
  user_id, token_hash, idle_expires_at, absolute_expires_at
) VALUES (
  '00000000-0000-4000-8000-000000000001', repeat('a', 64),
  now() + interval '30 days', now() + interval '90 days'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM workspace_memberships membership
    JOIN users app_user ON app_user.id = membership.user_id
    WHERE membership.workspace_id = 'primary'
      AND membership.user_id = '00000000-0000-4000-8000-000000000001'
      AND membership.role = 'owner'
      AND app_user.status = 'active'
  ) THEN
    RAISE EXCEPTION 'explicit workspace membership was not retained';
  END IF;
  IF (SELECT count(*) FROM app_sessions WHERE revoked_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'valid app session was not retained';
  END IF;

  BEGIN
    INSERT INTO app_sessions (
      user_id, token_hash, idle_expires_at, absolute_expires_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001', 'not-a-token-hash',
      now() + interval '1 day', now() + interval '2 days'
    );
    RAISE EXCEPTION 'invalid token hash was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;
