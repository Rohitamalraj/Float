import { privateKeyToAccount } from 'viem/accounts';
import type { Hex, LocalAccount } from 'viem';

/**
 * The seam for key custody. Today: private keys from env. Target: KMS/HSM-backed
 * signers with per-tenant isolation — swap the factory, not the callers.
 */
export interface FloatSigner {
  readonly role: SignerRole;
  readonly account: LocalAccount;
  readonly address: `0x${string}`;
}

export type SignerRole = 'oracle' | 'policy-sync' | 'agent-session' | 'provisioner';

export function envSigner(role: SignerRole, privateKey: Hex): FloatSigner {
  const account = privateKeyToAccount(privateKey);
  return { role, account, address: account.address };
}
