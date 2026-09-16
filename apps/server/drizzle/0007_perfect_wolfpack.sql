CREATE TABLE "event_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"name" varchar(80) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"support_level_id" uuid,
	"speech_template" varchar(500),
	"sound_asset_id" uuid,
	"cooldown_seconds" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_reactions_type_chk" CHECK ("event_reactions"."event_type" in ('moderator_seen', 'donor_seen', 'support_level_reached')),
	CONSTRAINT "event_reactions_cooldown_chk" CHECK ("event_reactions"."cooldown_seconds" between 0 and 86400),
	CONSTRAINT "event_reactions_position_chk" CHECK ("event_reactions"."position" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "support_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar(64) NOT NULL,
	"name" varchar(80) NOT NULL,
	"threshold_points" integer NOT NULL,
	"points_scope" varchar(16) NOT NULL,
	"privilege_duration" varchar(16) NOT NULL,
	"privilege_duration_days" integer,
	"grants_chat_speech" boolean DEFAULT false NOT NULL,
	"chat_speech_cooldown_seconds" integer DEFAULT 30 NOT NULL,
	"announcement_template" varchar(500),
	"sound_asset_id" uuid,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_levels_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "support_levels_threshold_chk" CHECK ("support_levels"."threshold_points" >= 1),
	CONSTRAINT "support_levels_scope_chk" CHECK ("support_levels"."points_scope" in ('stream', 'lifetime')),
	CONSTRAINT "support_levels_duration_chk" CHECK ("support_levels"."privilege_duration" in ('stream', 'days', 'permanent')),
	CONSTRAINT "support_levels_duration_days_chk" CHECK (("support_levels"."privilege_duration" = 'days' and "support_levels"."privilege_duration_days" between 1 and 3650) or ("support_levels"."privilege_duration" <> 'days' and "support_levels"."privilege_duration_days" is null)),
	CONSTRAINT "support_levels_cooldown_chk" CHECK ("support_levels"."chat_speech_cooldown_seconds" between 5 and 3600),
	CONSTRAINT "support_levels_position_chk" CHECK ("support_levels"."position" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "workspace_speech_policies" (
	"workspace_id" varchar(64) PRIMARY KEY NOT NULL,
	"moderator_speech_enabled" boolean DEFAULT false NOT NULL,
	"moderator_cooldown_seconds" integer DEFAULT 30 NOT NULL,
	"default_speech_cooldown_seconds" integer DEFAULT 30 NOT NULL,
	"max_message_characters" integer DEFAULT 200 NOT NULL,
	"max_queue_size" integer DEFAULT 20 NOT NULL,
	"read_user_name" boolean DEFAULT false NOT NULL,
	"fallback_language" varchar(16) DEFAULT 'ru-RU' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_speech_policies_moderator_cooldown_chk" CHECK ("workspace_speech_policies"."moderator_cooldown_seconds" between 5 and 3600),
	CONSTRAINT "workspace_speech_policies_default_cooldown_chk" CHECK ("workspace_speech_policies"."default_speech_cooldown_seconds" between 5 and 3600),
	CONSTRAINT "workspace_speech_policies_message_length_chk" CHECK ("workspace_speech_policies"."max_message_characters" between 20 and 500),
	CONSTRAINT "workspace_speech_policies_queue_size_chk" CHECK ("workspace_speech_policies"."max_queue_size" between 1 and 100),
	CONSTRAINT "workspace_speech_policies_revision_chk" CHECK ("workspace_speech_policies"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "event_reactions" ADD CONSTRAINT "event_reactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reactions" ADD CONSTRAINT "event_reactions_sound_asset_id_sound_library_assets_id_fk" FOREIGN KEY ("sound_asset_id") REFERENCES "public"."sound_library_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reactions" ADD CONSTRAINT "event_reactions_workspace_id_support_level_id_support_levels_workspace_id_id_fk" FOREIGN KEY ("workspace_id","support_level_id") REFERENCES "public"."support_levels"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_levels" ADD CONSTRAINT "support_levels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_levels" ADD CONSTRAINT "support_levels_sound_asset_id_sound_library_assets_id_fk" FOREIGN KEY ("sound_asset_id") REFERENCES "public"."sound_library_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_speech_policies" ADD CONSTRAINT "workspace_speech_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_reactions_workspace_position_idx" ON "event_reactions" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE INDEX "event_reactions_sound_asset_idx" ON "event_reactions" USING btree ("sound_asset_id");--> statement-breakpoint
CREATE INDEX "support_levels_workspace_position_idx" ON "support_levels" USING btree ("workspace_id","position");--> statement-breakpoint
CREATE INDEX "support_levels_sound_asset_idx" ON "support_levels" USING btree ("sound_asset_id");