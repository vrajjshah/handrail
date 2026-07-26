CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"scan_id" text NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"git_sha" text NOT NULL,
	"tool_version" text NOT NULL,
	"mode" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"scan_id" text NOT NULL,
	"check_id" text NOT NULL,
	"sc_primary" text NOT NULL,
	"tier" text NOT NULL,
	"severity" text NOT NULL,
	"page_url" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"scan_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "scan_events_scan_id_seq_pk" PRIMARY KEY("scan_id","seq")
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"phase" text NOT NULL,
	"target" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"degradations" jsonb NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"report" jsonb,
	"error" jsonb,
	"client_ip" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_scan_idx" ON "artifacts" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "artifacts_expires_idx" ON "artifacts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "eval_runs_created_at_idx" ON "eval_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "findings_scan_idx" ON "findings" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "findings_tier_idx" ON "findings" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "scans_status_idx" ON "scans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scans_created_at_idx" ON "scans" USING btree ("created_at");