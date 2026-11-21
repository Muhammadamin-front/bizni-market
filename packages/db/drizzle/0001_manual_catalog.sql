ALTER TABLE "categories" ADD COLUMN "source" text DEFAULT 'moysklad' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "local_status" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "source" text DEFAULT 'moysklad' NOT NULL;