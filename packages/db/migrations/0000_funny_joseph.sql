CREATE TYPE "public"."accreditation" AS ENUM('accredited', 'non_accredited', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'agent', 'oracle', 'system');--> statement-breakpoint
CREATE TYPE "public"."business_status" AS ENUM('onboarding', 'active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."compliance_source" AS ENUM('manual_admin', 'issuer_webhook');--> statement-breakpoint
CREATE TYPE "public"."kyc_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('none', 'pending', 'verified', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."obligation_recurrence" AS ENUM('none', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."obligation_status" AS ENUM('scheduled', 'covered', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."onchain_tx_kind" AS ENUM('oracle_attestation', 'ens_policy_write', 'ens_compliance_write', 'policy_view_sync', 'session_key_grant', 'session_key_revoke', 'fee_collection', 'account_deploy', 'subname_provision');--> statement-breakpoint
CREATE TYPE "public"."onchain_tx_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."session_key_status" AS ENUM('pending', 'active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."signer_role" AS ENUM('deployer', 'oracle', 'policy_sync', 'provisioner', 'agent_session');--> statement-breakpoint
CREATE TYPE "public"."sweep_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."sweep_status" AS ENUM('pending', 'submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'member', 'float_staff');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"nonce" varchar(96) NOT NULL,
	"chain_id" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip" varchar(45)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"address" varchar(42) NOT NULL,
	"email" text,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ens_name" text NOT NULL,
	"ens_node" varchar(66),
	"smart_account_address" varchar(42),
	"owner_key_address" varchar(42) NOT NULL,
	"chain_id" integer NOT NULL,
	"status" "business_status" DEFAULT 'onboarding' NOT NULL,
	"buffer_amount" numeric(78, 0),
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"buffer_amount" numeric(78, 0) NOT NULL,
	"max_sweep_per_tx" numeric(78, 0) NOT NULL,
	"allowed_protocol" varchar(42) NOT NULL,
	"target_yield_token" varchar(42) NOT NULL,
	"ens_synced_at" timestamp with time zone,
	"policy_view_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"agent_key_address" varchar(42) NOT NULL,
	"serialized_approval" text NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"status" "session_key_status" DEFAULT 'pending' NOT NULL,
	"granted_tx_hash" varchar(66),
	"granted_at" timestamp with time zone,
	"revoked_tx_hash" varchar(66),
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"kyc_status" "kyc_status" DEFAULT 'none' NOT NULL,
	"accreditation" "accreditation" DEFAULT 'unknown' NOT NULL,
	"allowlist_id" text,
	"source" "compliance_source" DEFAULT 'manual_admin' NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"registry_synced_at" timestamp with time zone,
	"ens_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"status" "kyc_review_status" DEFAULT 'pending' NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"notes" text,
	"attestation_tx_hash" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"recurrence" "obligation_recurrence" DEFAULT 'none' NOT NULL,
	"status" "obligation_status" DEFAULT 'scheduled' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"yield_token_balance" numeric(78, 0) DEFAULT '0' NOT NULL,
	"cost_basis_usdc" numeric(78, 0) DEFAULT '0' NOT NULL,
	"value_usdc" numeric(78, 0) DEFAULT '0' NOT NULL,
	"realized_yield_usdc" numeric(78, 0) DEFAULT '0' NOT NULL,
	"float_spread_usdc" numeric(78, 0) DEFAULT '0' NOT NULL,
	"last_valued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sweeps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"direction" "sweep_direction" NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"min_out" numeric(78, 0) NOT NULL,
	"decision_reason" text NOT NULL,
	"decision_detail" jsonb,
	"idempotency_key" text NOT NULL,
	"user_op_hash" varchar(66),
	"tx_hash" varchar(66),
	"status" "sweep_status" DEFAULT 'pending' NOT NULL,
	"gas_used" numeric(78, 0),
	"error" text,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"business_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_address" varchar(42),
	"endpoint" text NOT NULL,
	"ens_name" text,
	"request" jsonb,
	"response_summary" jsonb,
	"allowed" boolean,
	"paid_amount" numeric(78, 0),
	"x402_tx_hash" varchar(66),
	"status_code" smallint NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onchain_tx" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"kind" "onchain_tx_kind" NOT NULL,
	"signer_role" "signer_role" NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" varchar(66),
	"status" "onchain_tx_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"error" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watcher_cursors" (
	"id" text PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_keys" ADD CONSTRAINT "session_keys_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance" ADD CONSTRAINT "compliance_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_reviews" ADD CONSTRAINT "kyc_reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_reviews" ADD CONSTRAINT "kyc_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweeps" ADD CONSTRAINT "sweeps_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onchain_tx" ADD CONSTRAINT "onchain_tx_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_address_uq" ON "users" USING btree ("address");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_ens_name_uq" ON "businesses" USING btree ("ens_name");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_smart_account_uq" ON "businesses" USING btree ("smart_account_address");--> statement-breakpoint
CREATE INDEX "businesses_org_idx" ON "businesses" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "businesses_status_idx" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "session_keys_business_idx" ON "session_keys" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_keys_active_uq" ON "session_keys" USING btree ("business_id") WHERE status in ('pending', 'active');--> statement-breakpoint
CREATE INDEX "kyc_reviews_business_idx" ON "kyc_reviews" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "kyc_reviews_status_idx" ON "kyc_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "obligations_business_due_idx" ON "obligations" USING btree ("business_id","due_at");--> statement-breakpoint
CREATE INDEX "obligations_status_idx" ON "obligations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "sweeps_idempotency_uq" ON "sweeps" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sweeps_business_idx" ON "sweeps" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "sweeps_status_idx" ON "sweeps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_business_idx" ON "audit_log" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "gateway_calls_created_idx" ON "gateway_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gateway_calls_caller_idx" ON "gateway_calls" USING btree ("caller_address");--> statement-breakpoint
CREATE UNIQUE INDEX "onchain_tx_hash_uq" ON "onchain_tx" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "onchain_tx_business_idx" ON "onchain_tx" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "onchain_tx_kind_idx" ON "onchain_tx" USING btree ("kind");