CREATE TABLE "like_goal_settings" (
	"workspace_id" varchar(64) PRIMARY KEY NOT NULL,
	"target_count" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "like_goal_settings_target_count_chk" CHECK ("like_goal_settings"."target_count" is null or "like_goal_settings"."target_count" between 1 and 10000000),
	CONSTRAINT "like_goal_settings_revision_chk" CHECK ("like_goal_settings"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "like_goal_settings" ADD CONSTRAINT "like_goal_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;