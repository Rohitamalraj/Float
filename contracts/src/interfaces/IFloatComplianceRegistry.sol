// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IFloatComplianceRegistry
/// @notice The on-chain source of truth for which accounts Float's compliance
///         oracle has attested as KYC-verified and (optionally) accredited.
///         `FloatAllowlistChecker` reads this to gate Uniswap Permissioned Pool
///         swaps; the agent service mirrors the same state into ENS records.
interface IFloatComplianceRegistry {
    /// @dev KYC lifecycle, mirrors the `float.kyc-status` ENS record.
    enum KycStatus {
        None,
        Verified,
        Pending,
        Revoked,
        Expired
    }

    struct Attestation {
        KycStatus status;
        bool accredited;
        uint64 verifiedAt;
        /// @dev 0 == no expiry.
        uint64 expiresAt;
        /// @dev Opaque issuer allowlist id (e.g. keccak256("superstate-ustb-1")).
        bytes32 allowlistId;
    }

    event AttestationSet(
        address indexed account,
        KycStatus status,
        bool accredited,
        uint64 verifiedAt,
        uint64 expiresAt,
        bytes32 allowlistId
    );
    event AttestationRevoked(address indexed account, address indexed by);

    error ZeroAccount();
    error ExpiryInPast();

    /// @notice Write or overwrite an account's attestation. Oracle role only.
    function setAttestation(address account, KycStatus status, bool accredited, uint64 expiresAt, bytes32 allowlistId)
        external;

    /// @notice Force an account to `Revoked`. Oracle role only.
    function revoke(address account) external;

    /// @notice True iff status is `Verified` and the attestation has not expired.
    function isVerified(address account) external view returns (bool);

    /// @notice True iff {isVerified} and the account is flagged accredited.
    function isAccredited(address account) external view returns (bool);

    function attestationOf(address account) external view returns (Attestation memory);
}
