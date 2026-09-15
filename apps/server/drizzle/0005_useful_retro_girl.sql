ALTER TABLE "sound_library_assets" DROP CONSTRAINT "sound_library_assets_status_chk";--> statement-breakpoint
ALTER TABLE "sound_library_assets" ADD COLUMN "quarantine_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "sound_library_assets" ADD COLUMN "quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sound_library_assets" ADD COLUMN "quarantined_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "global_role" varchar(16) DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "sound_library_assets" ADD CONSTRAINT "sound_library_assets_quarantined_by_user_id_users_id_fk" FOREIGN KEY ("quarantined_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sound_library_assets" ADD CONSTRAINT "sound_library_assets_quarantine_chk" CHECK (("sound_library_assets"."status" = 'active' and "sound_library_assets"."quarantine_reason" is null and "sound_library_assets"."quarantined_at" is null) or ("sound_library_assets"."status" = 'quarantined' and "sound_library_assets"."quarantine_reason" is not null and "sound_library_assets"."quarantined_at" is not null));--> statement-breakpoint
ALTER TABLE "sound_library_assets" ADD CONSTRAINT "sound_library_assets_status_chk" CHECK ("sound_library_assets"."status" in ('active', 'quarantined'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_global_role_chk" CHECK ("users"."global_role" in ('user', 'admin'));