/**
 * Browser-safe entry point — for `apps/web`'s client components (session-key
 * grant/revoke, signed by the owner's own connected wallet). Deliberately a
 * curated subset, NOT `export * from` the root barrel: `./config.js` and
 * `./account.js` both import `@float/config`'s `loadEnv()` (`node:fs`) for
 * their server-side (env-driven) code paths, which a client bundle must never
 * see even transitively. See `client-config.ts`'s docstring.
 */
export { clientWalletRuntimeConfig } from './client-config.js';
export type { KernelVersion, WalletRuntimeConfig } from './config.js';
export { agentPermissionSpec, agentPolicySnapshot, buildAgentCallPolicy } from './policy.js';
export type { AgentPolicyParams, AgentPolicySnapshot } from './policy.js';
export {
  grantAgentSessionKey,
  revokeAgentSessionKey,
  bundlerTransportFromRuntime,
} from './session-key.js';
export type {
  OwnerSigner,
  GrantSessionKeyParams,
  GrantedSessionKey,
  RevokeSessionKeyParams,
} from './session-key.js';
