CREATE TABLE "supporter_level_grants" (
	"workspace_id" varchar(64) NOT NULL,
	"identity_key" varchar(64) NOT NULL,
	"support_level_id" uuid NOT NULL,
	"grant_key" varchar(80) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "supporter_level_grants_workspace_id_identity_key_support_level_id_grant_key_pk" PRIMARY KEY("workspace_id","identity_key","support_level_id","grant_key")
);
--> statement-breakpoint
CREATE TABLE "supporter_stream_totals" (
	"workspace_id" varchar(64) NOT NULL,
	"stream_id" uuid NOT NULL,
	"identity_key" varchar(64) NOT NULL,
	"points" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supporter_stream_totals_workspace_id_stream_id_identity_key_pk" PRIMARY KEY("workspace_id","stream_id","identity_key"),
	CONSTRAINT "supporter_stream_totals_points_chk" CHECK ("supporter_stream_totals"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supporters" (
	"workspace_id" varchar(64) NOT NULL,
	"identity_key" varchar(64) NOT NULL,
	"username" varchar(64) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"lifetime_points" bigint DEFAULT 0 NOT NULL,
	"first_supported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_supported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supporters_workspace_id_identity_key_pk" PRIMARY KEY("workspace_id","identity_key"),
	CONSTRAINT "supporters_identity_key_chk" CHECK ("supporters"."identity_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "supporters_lifetime_points_chk" CHECK ("supporters"."lifetime_points" >= 0)
);
--> statement-breakpoint
ALTER TABLE "supporter_level_grants" ADD CONSTRAINT "supporter_level_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporter_level_grants" ADD CONSTRAINT "supporter_level_grants_workspace_id_identity_key_supporters_workspace_id_identity_key_fk" FOREIGN KEY ("workspace_id","identity_key") REFERENCES "public"."supporters"("workspace_id","identity_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporter_level_grants" ADD CONSTRAINT "supporter_level_grants_workspace_id_support_level_id_support_levels_workspace_id_id_fk" FOREIGN KEY ("workspace_id","support_level_id") REFERENCES "public"."support_levels"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporter_stream_totals" ADD CONSTRAINT "supporter_stream_totals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporter_stream_totals" ADD CONSTRAINT "supporter_stream_totals_workspace_id_identity_key_supporters_workspace_id_identity_key_fk" FOREIGN KEY ("workspace_id","identity_key") REFERENCES "public"."supporters"("workspace_id","identity_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporters" ADD CONSTRAINT "supporters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supporter_level_grants_active_idx" ON "supporter_level_grants" USING btree ("workspace_id","identity_key","expires_at");--> statement-breakpoint
CREATE INDEX "supporters_workspace_points_idx" ON "supporters" USING btree ("workspace_id","lifetime_points");