// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The outcomes a committee may vote for.
/// @dev UNRESOLVABLE is not a third answer to the market's question — it is the
///      committee saying the question cannot be answered. It routes to
///      `Market.fail()`, which liquidates every side at its own price rather than
///      paying one of them, so a resolver reaching for it is choosing "nobody wins"
///      rather than picking a winner.
library Outcomes {
    uint8 internal constant NO = 0;
    uint8 internal constant YES = 1;
    uint8 internal constant UNRESOLVABLE = 2;
    /// @dev Not a vote. The absence of one.
    uint8 internal constant NONE = 3;
}

/// @notice The committee's view of one market's resolution (spec §7.2).
interface IResolutionModule {
    struct Round {
        uint8 n;
        uint8 k;
        uint8 index;
        uint8 proposedOutcome;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 disputeDeadline;
        uint16 commits;
        uint16 reveals;
        bool finalized;
    }
}
