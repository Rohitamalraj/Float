// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IFloatComplianceRegistry} from "@float/interfaces/IFloatComplianceRegistry.sol";

/// @title FloatComplianceRegistry
/// @notice Oracle-gated allowlist of KYC-verified business accounts.
/// @dev Two roles:
///      - DEFAULT_ADMIN_ROLE  : Float governance (multisig). Manages roles.
///      - COMPLIANCE_ORACLE_ROLE : the Float compliance-oracle service. The only
///        role that can write attestations. It is deliberately incapable of
///        granting itself anything else.
contract FloatComplianceRegistry is AccessControl, IFloatComplianceRegistry {
    bytes32 public constant COMPLIANCE_ORACLE_ROLE = keccak256("COMPLIANCE_ORACLE_ROLE");

    mapping(address account => Attestation) private _attestations;

    constructor(address admin, address oracle) {
        if (admin == address(0) || oracle == address(0)) revert ZeroAccount();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ORACLE_ROLE, oracle);
    }

    /// @inheritdoc IFloatComplianceRegistry
    function setAttestation(address account, KycStatus status, bool accredited, uint64 expiresAt, bytes32 allowlistId)
        external
        onlyRole(COMPLIANCE_ORACLE_ROLE)
    {
        if (account == address(0)) revert ZeroAccount();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert ExpiryInPast();

        uint64 verifiedAt = status == KycStatus.Verified ? uint64(block.timestamp) : 0;
        _attestations[account] = Attestation({
            status: status,
            accredited: accredited,
            verifiedAt: verifiedAt,
            expiresAt: expiresAt,
            allowlistId: allowlistId
        });

        emit AttestationSet(account, status, accredited, verifiedAt, expiresAt, allowlistId);
    }

    /// @inheritdoc IFloatComplianceRegistry
    function revoke(address account) external onlyRole(COMPLIANCE_ORACLE_ROLE) {
        Attestation storage a = _attestations[account];
        a.status = KycStatus.Revoked;
        a.accredited = false;
        emit AttestationRevoked(account, msg.sender);
    }

    /// @inheritdoc IFloatComplianceRegistry
    function isVerified(address account) public view returns (bool) {
        Attestation storage a = _attestations[account];
        if (a.status != KycStatus.Verified) return false;
        if (a.expiresAt != 0 && block.timestamp >= a.expiresAt) return false;
        return true;
    }

    /// @inheritdoc IFloatComplianceRegistry
    function isAccredited(address account) external view returns (bool) {
        return _attestations[account].accredited && isVerified(account);
    }

    /// @inheritdoc IFloatComplianceRegistry
    function attestationOf(address account) external view returns (Attestation memory) {
        return _attestations[account];
    }
}
