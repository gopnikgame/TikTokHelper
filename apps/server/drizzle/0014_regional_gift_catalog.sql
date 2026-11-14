CREATE TABLE "regional_gift_catalog" (
	"region" varchar(2) PRIMARY KEY NOT NULL,
	"gifts" jsonb NOT NULL,
	"updated_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"last_error" varchar(12),
	CONSTRAINT "regional_gift_catalog_region_chk" CHECK ("regional_gift_catalog"."region" in ('US', 'CA', 'AE', 'DE', 'BY'))
);
--> statement-breakpoint
ALTER TABLE "gift_catalog" ALTER COLUMN "first_seen_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_catalog" ALTER COLUMN "last_seen_at" DROP NOT NULL;