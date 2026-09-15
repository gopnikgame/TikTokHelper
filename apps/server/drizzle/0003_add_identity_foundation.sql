CREATE TABLE "app_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "app_sessions_token_hash_chk" CHECK ("app_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "app_sessions_idle_expiry_chk" CHECK ("app_sessions"."idle_expires_at" > "app_sessions"."created_at"),
	CONSTRAINT "app_sessions_absolute_expiry_chk" CHECK ("app_sessions"."absolute_expires_at" >= "app_sessions"."idle_expires_at"),
	CONSTRAINT "app_sessions_revoked_at_chk" CHECK ("app_sessions"."revoked_at" is null or "app_sessions"."revoked_at" >= "app_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_provider" varchar(32) DEFAULT 'vline' NOT NULL,
	"identity_subject" varchar(128) NOT NULL,
	"display_name" varchar(120),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_identity_provider_chk" CHECK ("users"."identity_provider" ~ '^[a-z][a-z0-9_-]{0,31}$'),
	CONSTRAINT "users_identity_subject_chk" CHECK (length(trim("users"."identity_subject")) > 0),
	CONSTRAINT "users_status_chk" CHECK ("users"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"workspace_id" varchar(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(16) DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_memberships_role_chk" CHECK ("workspace_memberships"."role" in ('owner', 'member'))
);
--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_sessions_token_hash_uidx" ON "app_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "app_sessions_user_idx" ON "app_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "app_sessions_expiry_idx" ON "app_sessions" USING btree ("idle_expires_at","absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_identity_uidx" ON "users" USING btree ("identity_provider","identity_subject");--> statement-breakpoint
CREATE INDEX "workspace_memberships_user_idx" ON "workspace_memberships" USING btree ("user_id");