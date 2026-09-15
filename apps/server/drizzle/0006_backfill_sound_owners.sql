UPDATE "sound_library_assets" AS "asset"
SET "created_by_user_id" = "owner"."user_id"
FROM (
  SELECT "workspace_id", min("user_id"::text)::uuid AS "user_id"
  FROM "workspace_memberships"
  WHERE "role" = 'owner'
  GROUP BY "workspace_id"
  HAVING count(*) = 1
) AS "owner"
WHERE "asset"."created_by_user_id" IS NULL
  AND "asset"."storage_key" LIKE 'uploaded/%'
  AND "asset"."original_workspace_id" = "owner"."workspace_id";
