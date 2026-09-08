import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['owner', 'admin', 'member', 'float_staff']);

export const businessStatus = pgEnum('business_status', [
  'onboarding',
  'active',
  'suspended',
  'closed',
]);

export const sessionKeyStatus = pgEnum('session_key_status', [
  'pending',
  'active',
  'revoked',
  'expired',
]);

export const kycStatus = pgEnum('kyc_status', [
  'none',
  'pending',
  'verified',
  'revoked',
  'expired',
]);

export const accreditation = pgEnum('accreditation', ['accredited', 'non_accredited', 'unknown']);

export const complianceSource = pgEnum('compliance_source', ['manual_admin', 'issuer_webhook']);

export const kycReviewStatus = pgEnum('kyc_review_status', ['pending', 'approved', 'rejected']);

export const obligationRecurrence = pgEnum('obligation_recurrence', ['none', 'weekly', 'monthly']);

export const obligationStatus = pgEnum('obligation_status', [
  'scheduled',
  'covered',
  'paid',
  'cancelled',
]);

export const sweepDirection = pgEnum('sweep_direction', ['in', 'out']);

export const sweepStatus = pgEnum('sweep_status', ['pending', 'submitted', 'confirmed', 'failed']);

export const onchainTxKind = pgEnum('onchain_tx_kind', [
  'oracle_attestation',
  'ens_policy_write',
  'ens_compliance_write',
  'policy_view_sync',
  'session_key_grant',
  'session_key_revoke',
  'fee_collection',
  'account_deploy',
  'subname_provision',
]);

export const onchainTxStatus = pgEnum('onchain_tx_status', ['pending', 'confirmed', 'failed']);

export const signerRole = pgEnum('signer_role', [
  'deployer',
  'oracle',
  'policy_sync',
  'provisioner',
  'agent_session',
]);

export const auditActorType = pgEnum('audit_actor_type', ['user', 'agent', 'oracle', 'system']);
