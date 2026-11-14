ALTER TABLE "event_reactions" DROP CONSTRAINT "event_reactions_type_chk";--> statement-breakpoint
ALTER TABLE "event_reactions" ADD COLUMN "gift_id" varchar(80);--> statement-breakpoint
ALTER TABLE "event_reactions" ADD COLUMN "minimum_gift_points" integer;--> statement-breakpoint
ALTER TABLE "event_reactions" ADD CONSTRAINT "event_reactions_gift_id_gift_catalog_gift_id_fk" FOREIGN KEY ("gift_id") REFERENCES "public"."gift_catalog"("gift_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reactions" ADD CONSTRAINT "event_reactions_gift_filter_chk" CHECK ((
    "event_reactions"."event_type" = 'gift_completed' and "event_reactions"."support_level_id" is null
      and "event_reactions"."minimum_gift_points" is not null and "event_reactions"."minimum_gift_points" >= 0
  ) or (
    "event_reactions"."event_type" <> 'gift_completed' and "event_reactions"."gift_id" is null and "event_reactions"."minimum_gift_points" is null
  ));--> statement-breakpoint
ALTER TABLE "event_reactions" ADD CONSTRAINT "event_reactions_type_chk" CHECK ("event_reactions"."event_type" in ('moderator_seen', 'donor_seen', 'support_level_reached', 'gift_completed'));