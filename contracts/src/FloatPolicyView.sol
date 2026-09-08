// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IFloatPolicyView} from "@float/interfaces/IFloatPolicyView.sol";

/// @title FloatPolicyView
/// @notice See {IFloatPolicyView}. A thin, oracle-written key/value store; it does
///         not itself authorise anything — Layer 1 (the session-key call policy)
///         is the cryptographic ceiling. This only lets the executor reject an
///         obviously out-of-policy amount early, on-chain, with a clear revert.
contract FloatPolicyView is AccessControl, IFloatPolicyView {
    bytes32 public constant POLICY_SYNC_ROLE = keccak256("POLICY_SYNC_ROLE");

    mapping(address account => AccountPolicy) private _policies;

    constructor(address admin, address policySync) {
        if (admin == address(0) || policySync == address(0)) revert ZeroAccount();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POLICY_SYNC_ROLE, policySync);
    }

    /// @inheritdoc IFloatPolicyView
    function setPolicy(address account, uint128 bufferAmount_, uint128 maxSweepPerTx_)
        external
        onlyRole(POLICY_SYNC_ROLE)
    {
        if (account == address(0)) revert ZeroAccount();
        _policies[account] = AccountPolicy({set: true, bufferAmount: bufferAmount_, maxSweepPerTx: maxSweepPerTx_});
        emit PolicySynced(account, bufferAmount_, maxSweepPerTx_, msg.sender);
    }

    /// @inheritdoc IFloatPolicyView
    function clearPolicy(address account) external onlyRole(POLICY_SYNC_ROLE) {
        delete _policies[account];
        emit PolicyCleared(account, msg.sender);
    }

    /// @inheritdoc IFloatPolicyView
    function policyOf(address account) external view returns (AccountPolicy memory) {
        return _policies[account];
    }

    /// @inheritdoc IFloatPolicyView
    function maxSweepPerTx(address account) external view returns (uint256) {
        AccountPolicy storage p = _policies[account];
        if (!p.set) revert PolicyNotSet(account);
        return p.maxSweepPerTx;
    }

    /// @inheritdoc IFloatPolicyView
    function bufferAmount(address account) external view returns (uint256) {
        AccountPolicy storage p = _policies[account];
        if (!p.set) revert PolicyNotSet(account);
        return p.bufferAmount;
    }
}
