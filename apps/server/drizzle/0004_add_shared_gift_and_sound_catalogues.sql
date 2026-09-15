CREATE TABLE "gift_catalog" (
	"gift_id" varchar(80) PRIMARY KEY NOT NULL,
	"gift_name" varchar(160) NOT NULL,
	"image_url" text,
	"diamond_count" integer,
	"first_seen_workspace_id" varchar(64),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_catalog_diamond_count_chk" CHECK ("gift_catalog"."diamond_count" is null or "gift_catalog"."diamond_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sound_library_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_workspace_id" varchar(64),
	"created_by_user_id" uuid,
	"storage_key" text NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"duration_ms" integer,
	"content_sha256" varchar(64),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sound_library_assets_duration_chk" CHECK ("sound_library_assets"."duration_ms" is null or "sound_library_assets"."duration_ms" > 0),
	CONSTRAINT "sound_library_assets_sha256_chk" CHECK ("sound_library_assets"."content_sha256" is null or "sound_library_assets"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sound_library_assets_status_chk" CHECK ("sound_library_assets"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "gift_sound_rules" DROP CONSTRAINT "gift_sound_rules_workspace_id_sound_asset_id_sound_assets_workspace_id_id_fk";
--> statement-breakpoint
INSERT INTO "gift_catalog" (
	"gift_id", "gift_name", "image_url", "diamond_count", "first_seen_workspace_id", "first_seen_at", "last_seen_at"
)
SELECT
	"gift_id",
	(array_agg("gift_name" ORDER BY "last_seen_at" DESC))[1],
	(array_agg("image_url" ORDER BY ("image_url" IS NULL), "last_seen_at" DESC))[1],
	(array_agg("diamond_count" ORDER BY ("diamond_count" IS NULL), "last_seen_at" DESC))[1],
	(array_agg("workspace_id" ORDER BY "first_seen_at" ASC))[1],
	min("first_seen_at"),
	max("last_seen_at")
FROM "observed_gifts"
GROUP BY "gift_id";
--> statement-breakpoint
INSERT INTO "sound_library_assets" (
	"id", "original_workspace_id", "storage_key", "display_name", "mime_type", "duration_ms", "created_at"
)
SELECT DISTINCT ON ("storage_key")
	"id", "workspace_id", "storage_key", "display_name", "mime_type", "duration_ms", "created_at"
FROM "sound_assets"
ORDER BY "storage_key", "created_at" ASC, "id" ASC;
--> statement-breakpoint
UPDATE "gift_sound_rules" AS "rule"
SET "sound_asset_id" = "library"."id"
FROM "sound_assets" AS "legacy"
JOIN "sound_library_assets" AS "library" ON "library"."storage_key" = "legacy"."storage_key"
WHERE "rule"."workspace_id" = "legacy"."workspace_id"
	AND "rule"."sound_asset_id" = "legacy"."id";
--> statement-breakpoint
ALTER TABLE "gift_catalog" ADD CONSTRAINT "gift_catalog_first_seen_workspace_id_workspaces_id_fk" FOREIGN KEY ("first_seen_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sound_library_assets" ADD CONSTRAINT "sound_library_assets_original_workspace_id_workspaces_id_fk" FOREIGN KEY ("original_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sound_library_assets" ADD CONSTRAINT "sound_library_assets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_catalog_last_seen_idx" ON "gift_catalog" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sound_library_assets_storage_uidx" ON "sound_library_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "sound_library_assets_creator_idx" ON "sound_library_assets" USING btree ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "gift_sound_rules" ADD CONSTRAINT "gift_sound_rules_sound_asset_id_sound_library_assets_id_fk" FOREIGN KEY ("sound_asset_id") REFERENCES "public"."sound_library_assets"("id") ON DELETE restrict ON UPDATE no action;
