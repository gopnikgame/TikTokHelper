CREATE TABLE "observed_gifts" (
	"workspace_id" varchar(64) NOT NULL,
	"gift_id" varchar(80) NOT NULL,
	"gift_name" varchar(160) NOT NULL,
	"image_url" text,
	"diamond_count" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observed_gifts_workspace_id_gift_id_pk" PRIMARY KEY("workspace_id","gift_id"),
	CONSTRAINT "observed_gifts_diamond_count_chk" CHECK ("observed_gifts"."diamond_count" is null or "observed_gifts"."diamond_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "observed_gifts" ADD CONSTRAINT "observed_gifts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "observed_gifts_workspace_last_seen_idx" ON "observed_gifts" USING btree ("workspace_id","last_seen_at");