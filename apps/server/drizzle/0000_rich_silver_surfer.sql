CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"tiktok_username" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_sound_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"gift_id" varchar(80) NOT NULL,
	"sound_asset_id" uuid NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_gift_events" (
	"workspace_id" varchar(64) NOT NULL,
	"event_id" varchar(160) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "processed_gift_events_workspace_id_event_id_pk" PRIMARY KEY("workspace_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "sound_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"storage_key" text NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sound_assets_duration_chk" CHECK ("sound_assets"."duration_ms" is null or "sound_assets"."duration_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_preferences" (
	"workspace_id" varchar(64) PRIMARY KEY NOT NULL,
	"playback_mode" text DEFAULT 'controlled_overlap' NOT NULL,
	"overlap_percent" smallint DEFAULT 25 NOT NULL,
	"max_concurrent_sounds" smallint DEFAULT 4 NOT NULL,
	"volume_percent" smallint DEFAULT 80 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_preferences_playback_mode_chk" CHECK ("workspace_preferences"."playback_mode" in ('controlled_overlap', 'sequential', 'strong_overlap')),
	CONSTRAINT "workspace_preferences_overlap_chk" CHECK ("workspace_preferences"."overlap_percent" between 0 and 100),
	CONSTRAINT "workspace_preferences_concurrency_chk" CHECK ("workspace_preferences"."max_concurrent_sounds" between 1 and 32),
	CONSTRAINT "workspace_preferences_volume_chk" CHECK ("workspace_preferences"."volume_percent" between 0 and 100),
	CONSTRAINT "workspace_preferences_revision_chk" CHECK ("workspace_preferences"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_sound_rules" ADD CONSTRAINT "gift_sound_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_sound_rules" ADD CONSTRAINT "gift_sound_rules_workspace_id_sound_asset_id_sound_assets_workspace_id_id_fk" FOREIGN KEY ("workspace_id","sound_asset_id") REFERENCES "public"."sound_assets"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_gift_events" ADD CONSTRAINT "processed_gift_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sound_assets" ADD CONSTRAINT "sound_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_preferences" ADD CONSTRAINT "workspace_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_workspace_uidx" ON "channels" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "channels_workspace_idx" ON "channels" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_sound_rules_workspace_gift_uidx" ON "gift_sound_rules" USING btree ("workspace_id","gift_id");--> statement-breakpoint
CREATE INDEX "gift_sound_rules_workspace_idx" ON "gift_sound_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "gift_sound_rules_sound_asset_idx" ON "gift_sound_rules" USING btree ("sound_asset_id");--> statement-breakpoint
CREATE INDEX "processed_gift_events_expiry_idx" ON "processed_gift_events" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sound_assets_workspace_storage_uidx" ON "sound_assets" USING btree ("workspace_id","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sound_assets_workspace_id_uidx" ON "sound_assets" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "sound_assets_workspace_idx" ON "sound_assets" USING btree ("workspace_id");