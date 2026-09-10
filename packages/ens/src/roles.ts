/**
 * ENS v2 Enhanced Access Control role bitmaps.
 *
 * EAC packs each logical role into the low bit of a nibble; the paired admin
 * role sits at `role << 128`. Roles are granted per resource (a name, or a
 * name+record-key), or contract-wide on ROOT_RESOURCE.
 */

// ── PermissionedRegistry roles (subname lifecycle) ──────────────────────────
export const ROLE_REGISTRAR = 1n << 0n;
export const ROLE_REGISTER_RESERVED = 1n << 4n;
export const ROLE_SET_PARENT = 1n << 8n;
export const ROLE_UNREGISTER = 1n << 12n;
export const ROLE_RENEW = 1n << 16n;
export const ROLE_SET_SUBREGISTRY = 1n << 20n;
export const ROLE_SET_RESOLVER = 1n << 24n;
export const ROLE_SET_TOKEN_URI = 1n << 36n;
export const ROLE_UPGRADE = 1n << 124n;

const ADMIN = 128n;

/** Roles Float grants the business on its subname: full self-management of its own name. */
export const V2_BUSINESS_OWNER_ROLE_BITMAP =
  ROLE_UNREGISTER |
  ROLE_RENEW |
  ROLE_SET_SUBREGISTRY |
  ROLE_SET_RESOLVER |
  (ROLE_UNREGISTER << ADMIN) |
  (ROLE_RENEW << ADMIN) |
  (ROLE_SET_SUBREGISTRY << ADMIN) |
  (ROLE_SET_RESOLVER << ADMIN);

// ── PermissionedResolver roles (record writes) ─────────────────────────────
export const ROLE_SET_ADDR = 1n << 0n;
export const ROLE_SET_TEXT = 1n << 4n;
export const ROLE_SET_CONTENTHASH = 1n << 8n;

/**
 * Everything, across every resource — the all-roles grant bitmap the resolver
 * `initialize(admin, roleBitmap, …)` expects for its root admin (Float's
 * provisioner). Not a lock/fuse mask.
 */
export const ALL_RESOLVER_ROLES = BigInt(
  '0x1111111111111111111111111111111111111111111111111111111111111111',
);

export const MAX_UINT64 = (1n << 64n) - 1n;
