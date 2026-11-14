CREATE TABLE "processed_gift_streaks" (
	"workspace_id" varchar(64) NOT NULL,
	"streak_key" varchar(64) NOT NULL,
	"repeat_count" bigint NOT NULL,
	CONSTRAINT "processed_gift_streaks_workspace_id_streak_key_pk" PRIMARY KEY("workspace_id","streak_key"),
	CONSTRAINT "processed_gift_streaks_repeat_count_chk" CHECK ("processed_gift_streaks"."repeat_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "processed_gift_streaks" ADD CONSTRAINT "processed_gift_streaks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;