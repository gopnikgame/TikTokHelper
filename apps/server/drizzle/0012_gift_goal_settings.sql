CREATE TABLE "gift_goal_settings" (
	"workspace_id" varchar(64) PRIMARY KEY NOT NULL,
	"gift_id" varchar(80) NOT NULL,
	"target_count" integer NOT NULL,
	"sound_asset_id" uuid,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "gift_goal_settings_target_count_chk" CHECK ("gift_goal_settings"."target_count" between 1 and 1000000),
	CONSTRAINT "gift_goal_settings_revision_chk" CHECK ("gift_goal_settings"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "gift_goal_settings" ADD CONSTRAINT "gift_goal_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_goal_settings" ADD CONSTRAINT "gift_goal_settings_gift_id_gift_catalog_gift_id_fk" FOREIGN KEY ("gift_id") REFERENCES "public"."gift_catalog"("gift_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_goal_settings" ADD CONSTRAINT "gift_goal_settings_sound_asset_id_sound_library_assets_id_fk" FOREIGN KEY ("sound_asset_id") REFERENCES "public"."sound_library_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_goal_settings_gift_idx" ON "gift_goal_settings" USING btree ("gift_id");--> statement-breakpoint
CREATE INDEX "gift_goal_settings_sound_asset_idx" ON "gift_goal_settings" USING btree ("sound_asset_id");