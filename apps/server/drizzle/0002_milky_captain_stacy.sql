CREATE TABLE "recent_channels" (
	"workspace_id" varchar(64) NOT NULL,
	"tiktok_username" varchar(24) NOT NULL,
	"connection_count" integer DEFAULT 1 NOT NULL,
	"first_connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recent_channels_workspace_id_tiktok_username_pk" PRIMARY KEY("workspace_id","tiktok_username"),
	CONSTRAINT "recent_channels_connection_count_chk" CHECK ("recent_channels"."connection_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "recent_channels" ADD CONSTRAINT "recent_channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recent_channels_workspace_last_connected_idx" ON "recent_channels" USING btree ("workspace_id","last_connected_at");--> statement-breakpoint
INSERT INTO "recent_channels" ("workspace_id", "tiktok_username", "connection_count", "first_connected_at", "last_connected_at")
SELECT "workspace_id", lower(trim(leading '@' from "tiktok_username")), 1, "created_at", "updated_at"
FROM "channels"
WHERE trim(leading '@' from "tiktok_username") <> ''
ON CONFLICT ("workspace_id", "tiktok_username") DO NOTHING;
