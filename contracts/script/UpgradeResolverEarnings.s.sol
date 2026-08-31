// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ResolutionModule} from "../src/core/ResolutionModule.sol";

/// @notice Upgrade a live ResolutionModule to the one that pays its resolvers.
///
/// @dev THIS UPGRADE ADDS STORAGE, which is the reason for every check below.
///      `owedTo`, `totalOwed` and `owedToken` were APPENDED after the last
///      existing mapping. Inserting them anywhere else would shift every slot
///      after the insertion point, and the symptom is not a revert — it is a
///      getter quietly returning the neighbouring mapping's contents. That
///      happened once on AgentRegistry in this repository, and the only reason
///      it was caught was a script like this one reading state before and
///      comparing after.
///
///      What is read back: the resolver allowlist, the per-market round, the
///      committee, the receipt roots and the `viaCommittee` flag of an existing
///      market. Those are the mappings a shift would corrupt, and none of them
///      is enumerable — so the market to check is passed in rather than
///      discovered.
///
///        MARKET=0x… DEPLOYER_KEY=… forge script script/UpgradeResolverEarnings.s.sol \
///          --rpc-url "$RPC" --broadcast
contract UpgradeResolverEarnings is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);
        address market = vm.envAddress("MARKET");

        string memory path = string.concat("../deployments/", vm.toString(block.chainid), ".json");
        string memory manifest = vm.readFile(path);
        ResolutionModule module = ResolutionModule(vm.parseJsonAddress(manifest, ".contracts.ResolutionModule"));
        require(module.owner() == deployer, "UpgradeResolverEarnings: deployer does not own the module");

        // ── before ────────────────────────────────────────────────────────────
        uint256[] memory committee = module.committeeOf(market);
        require(committee.length > 0, "UpgradeResolverEarnings: MARKET has no round to check against");
        bool viaCommitteeBefore = module.viaCommittee(market);
        bytes32[] memory rootsBefore = new bytes32[](committee.length);
        for (uint256 i = 0; i < committee.length; i++) {
            rootsBefore[i] = module.receiptRootOf(market, committee[i]);
        }
        ResolutionModule.Round memory roundBefore = module.roundOf(market);

        vm.startBroadcast(pk);
        ResolutionModule impl = new ResolutionModule();
        module.upgradeToAndCall(address(impl), "");
        vm.stopBroadcast();

        // ── after ─────────────────────────────────────────────────────────────
        require(module.viaCommittee(market) == viaCommitteeBefore, "viaCommittee moved");
        uint256[] memory after_ = module.committeeOf(market);
        require(after_.length == committee.length, "the committee changed length");
        for (uint256 i = 0; i < committee.length; i++) {
            require(after_[i] == committee[i], "a committee member moved");
            require(module.receiptRootOf(market, committee[i]) == rootsBefore[i], "a receipt root moved");
        }
        ResolutionModule.Round memory roundAfter = module.roundOf(market);
        require(roundAfter.n == roundBefore.n, "round.n moved");
        require(roundAfter.commits == roundBefore.commits, "round.commits moved");
        require(roundAfter.finalized == roundBefore.finalized, "round.finalized moved");

        // The new slots must read as empty on a contract that has never used
        // them. A non-zero here means they were laid over something.
        require(module.totalOwed() == 0, "totalOwed is not empty on a fresh append");
        require(module.owedTo(committee[0]) == 0, "owedTo is not empty on a fresh append");

        vm.writeJson(vm.toString(address(impl)), path, ".contracts.ResolutionModuleImpl");

        console2.log("ResolutionModule impl:", address(impl));
        console2.log("state intact for market:", market);
        console2.log("committee members checked:", committee.length);
    }
}
