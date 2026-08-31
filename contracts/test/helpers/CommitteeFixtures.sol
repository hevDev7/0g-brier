// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {Fixtures} from "./Fixtures.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {AgentRegistry} from "../../src/core/AgentRegistry.sol";
import {ResolutionModule} from "../../src/core/ResolutionModule.sol";
import {IAgentRegistry} from "../../src/interfaces/IAgentRegistry.sol";
import {Market} from "../../src/core/Market.sol";

/// @dev A staked committee, wired the way a deployment wires it. Extends the base
///      fixture rather than replacing it, so every market helper still applies.
/// @dev `ERC721Holder` because `register` uses `_safeMint`, which refuses a contract
///      that cannot receive an NFT. That is the right behaviour for this registry — an
///      agent's owner may well be a multisig or an AgentAccount, and minting one into a
///      contract that cannot move it would strand it — so the test adapts, not the code.
abstract contract CommitteeFixtures is Fixtures, ERC721Holder {
    AgentRegistry internal registry_;
    ResolutionModule internal module;

    /// @dev One operator key per resolver. They must be distinct: the commitment binds
    ///      `msg.sender`, so a shared operator would make several members' commitments
    ///      interchangeable and quietly defeat the thing commit–reveal is for.
    address[] internal operators;
    uint256[] internal agentIds;

    function _deployCommittee(uint256 resolverCount, uint256 stakeEach) internal {
        AgentRegistry regImpl = new AgentRegistry();
        registry_ = AgentRegistry(
            address(
                new ERC1967Proxy(
                    address(regImpl), abi.encodeCall(AgentRegistry.initialize, (address(this), address(config)))
                )
            )
        );
        ResolutionModule modImpl = new ResolutionModule();
        module = ResolutionModule(
            address(
                new ERC1967Proxy(
                    address(modImpl), abi.encodeCall(ResolutionModule.initialize, (address(this), address(config)))
                )
            )
        );

        config.setAddress(ConfigKeys.AGENT_REGISTRY, address(registry_));
        config.setAddress(ConfigKeys.RESOLUTION_MODULE, address(module));
        config.setAddress(ConfigKeys.STAKE_TOKEN, address(usdc));
        config.setAddress(ConfigKeys.MARKET_FACTORY, address(registry));

        for (uint256 i = 0; i < resolverCount; i++) {
            address op = vm.addr(uint256(keccak256(abi.encode("operator", i))));
            operators.push(op);
            uint256 id = registry_.register(
                IAgentRegistry.Role.Resolver,
                op,
                bytes32(abi.encodePacked("resolver-", bytes1(uint8(48 + i)))),
                keccak256(abi.encode("meta", i))
            );
            agentIds.push(id);
            usdc.mintTo(address(this), stakeEach);
            usdc.approve(address(registry_), stakeEach);
            registry_.stake(id, stakeEach);
        }
    }

    function _closedMarket() internal returns (Market m) {
        m = _newMarket(SEED);
        vm.warp(block.timestamp + TRADING_WINDOW + 1);
        m.close();
    }

    /// @dev The two-phase draw, as a keeper performs it: ask, wait out
    ///      `RESOLUTION_DRAW_DELAY`, then open. Sampling cannot happen in one call —
    ///      a seed the caller can read before it commits is a seed the caller chooses.
    function _openRound1(address market) internal {
        module.requestResolution(market);
        _rollPastDraw(market);
        module.openResolution(market);
    }

    function _openRound2(address market) internal {
        _rollPastDraw(market);
        module.openDisputeRound(market);
    }

    /// @dev Rolls to one block past the draw block, giving that block a hash. Foundry
    ///      leaves `blockhash` zero for blocks it never mined, and a zero seed is the
    ///      one value `_consumeDraw` refuses.
    function _rollPastDraw(address market) internal {
        uint64 drawBlock = module.drawOf(market).drawBlock;
        vm.roll(drawBlock + 1);
        vm.setBlockhash(drawBlock, keccak256(abi.encode("draw", market, drawBlock)));
    }

    function _commitment(address market, uint8 outcome, bytes32 salt, bytes32 receipt, address who)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(market, outcome, salt, receipt, who));
    }

    /// @dev Everyone on the committee commits and reveals the same outcome.
    function _committeeAgrees(address market, uint8 outcome) internal {
        uint256[] memory members = module.committeeOf(market);
        for (uint256 i = 0; i < members.length; i++) {
            address op = registry_.operatorOf(members[i]);
            bytes32 salt = keccak256(abi.encode("salt", members[i]));
            bytes32 receipt = keccak256(abi.encode("receipt", members[i]));
            vm.prank(op);
            module.commitVote(market, members[i], _commitment(market, outcome, salt, receipt, op));
        }
        vm.warp(module.roundOf(market).commitDeadline + 1);
        for (uint256 i = 0; i < members.length; i++) {
            address op = registry_.operatorOf(members[i]);
            vm.prank(op);
            module.revealVote(
                market,
                members[i],
                outcome,
                keccak256(abi.encode("salt", members[i])),
                keccak256(abi.encode("receipt", members[i]))
            );
        }
    }
}
