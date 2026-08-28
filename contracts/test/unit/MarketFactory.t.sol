// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "../helpers/Fixtures.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {MarketFactory} from "../../src/core/MarketFactory.sol";
import {Market} from "../../src/core/Market.sol";
import {OutcomeShares} from "../../src/core/OutcomeShares.sol";
import {IMarket} from "../../src/interfaces/IMarket.sol";
import {ConfigKeys} from "../../src/core/ConfigKeys.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";
import {AgentRegistry} from "../../src/core/AgentRegistry.sol";
import {IAgentRegistry} from "../../src/interfaces/IAgentRegistry.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/// @dev A collateral token that re-enters `MarketFactory.createMarket` from inside its own
///      `transferFrom` — the one external call `createMarket` makes after it has already
///      written `usedApprovals`, `isMarket` and `_markets`.
///
///      It records the re-entry's revert data rather than letting it bubble, so the test can
///      assert WHICH guard stopped it. It disarms before re-entering: an armed re-entry with
///      no guard would recurse until the EVM call depth ran out, and "it reverted" would then
///      prove nothing about `nonReentrant`.
contract ReentrantCollateral is ERC20 {
    MarketFactory public factory;
    IMarket.Params internal _params;
    uint256 internal _seed;
    uint256 internal _deposit;
    uint256 internal _nonce;
    bytes internal _sig;
    bool public armed;
    bytes public lastRevert;
    bool public reentryReturned;

    constructor() ERC20("Reentrant", "RE") {}

    function mintTo(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(
        MarketFactory factory_,
        IMarket.Params calldata p,
        uint256 seedTokens,
        uint256 depositTokens,
        uint256 nonce,
        bytes calldata sig
    ) external {
        factory = factory_;
        _params = p;
        _seed = seedTokens;
        _deposit = depositTokens;
        _nonce = nonce;
        _sig = sig;
        armed = true;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (armed) {
            armed = false;
            try factory.createMarket(_params, _seed, _deposit, _nonce, _sig) returns (address) {
                reentryReturned = true;
            } catch (bytes memory err) {
                lastRevert = err;
            }
        }
        return super.transferFrom(from, to, value);
    }
}

contract MarketFactoryTest is Fixtures {
    MarketFactory internal factory;
    uint256 internal curatorPk = 0xC0FFEE;
    address internal curator;
    /// @dev A real registry, not a stub: `_params()` credits agent 1, and since the factory
    ///      now verifies that claim the fixture has to make it true. Deployed and minted here
    ///      so every existing test keeps testing what it was written to test.
    AgentRegistry internal agents;

    function setUp() public {
        _deployBase();
        curator = vm.addr(curatorPk);

        // This order mirrors Deploy.s.sol and CANNOT be reversed:
        //   clean shares → factory (snapshots the shares address) → shares.setRegistry(factory).
        // `_deployBase` has already spent the one-shot `setRegistry` key on StubMarketRegistry,
        // so that instance can never be redirected to the real factory; `_freshShares` starts
        // from an empty one. Conversely the factory cannot be born later without making the
        // `shares` it snapshotted stale — see the note in Fixtures.
        _freshShares();

        MarketFactory impl = new MarketFactory();
        factory = MarketFactory(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        MarketFactory.initialize, (address(this), address(config), address(shares), address(marketImpl))
                    )
                )
            )
        );
        AgentRegistry agentImpl = new AgentRegistry();
        agents = AgentRegistry(
            address(
                new ERC1967Proxy(
                    address(agentImpl), abi.encodeCall(AgentRegistry.initialize, (address(this), address(config)))
                )
            )
        );
        // Minted BY `creator` so the NFT lands in `creator`'s hands: `register` calls
        // `_safeMint(msg.sender, …)`, and it is ownership that `_params().creatorAgentId = 1`
        // has to match. Operator is left unset so the owner path is what these tests exercise;
        // the operator path has a test of its own below.
        vm.prank(creator);
        uint256 minted = agents.register(IAgentRegistry.Role.Creator, address(0), "creator-one", bytes32(0));
        assertEq(minted, 1, "fixture assumes agent 1");

        config.setAddress(ConfigKeys.AGENT_REGISTRY, address(agents));
        config.setAddress(ConfigKeys.MARKET_FACTORY, address(factory));
        config.setAddress(ConfigKeys.CURATOR_SIGNER, curator);
        _useFactoryAsRegistry(address(factory));

        _fund(creator, 1_000_000e6, address(factory));
    }

    /// @dev MAKES two external calls into the factory (`MARKET_APPROVAL_TYPEHASH` and
    ///      `hashTypedData`). It must therefore never be evaluated as an inline argument to a
    ///      call already armed with `vm.prank`/`vm.expectRevert`: those cheatcodes bind to the
    ///      very NEXT external call, literally, and the next one would be a view call in here
    ///      rather than `createMarket`. Every test below computes its signature into a local
    ///      variable FIRST.
    function _sign(IMarket.Params memory p, uint256 nonce) internal view returns (bytes memory) {
        return _signAmounts(p, SEED, DEPOSIT, nonce);
    }

    function _structHash(IMarket.Params memory p, uint256 seedTokens, uint256 depositTokens, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                factory.MARKET_APPROVAL_TYPEHASH(),
                p.specRoot,
                p.tradingEnd,
                p.settlementDeadline,
                p.tier,
                p.creatorAgentId,
                p.category,
                p.creator,
                p.collateral,
                seedTokens,
                depositTokens,
                nonce
            )
        );
    }

    function _signAmounts(IMarket.Params memory p, uint256 seedTokens, uint256 depositTokens, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = factory.hashTypedData(_structHash(p, seedTokens, depositTokens, nonce));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(curatorPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_createMarketDeploysCloneAndSeedsIt() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);

        // topic1 (the market address) cannot be known before the clone exists; everything else is
        // checked in full, because an indexer rebuilds the market catalogue from this event alone.
        vm.expectEmit(false, true, true, true, address(factory));
        emit MarketFactory.MarketCreated(address(0), creator, p.creatorAgentId, p.specRoot, SEED, p.tier);
        vm.prank(creator);
        address addr = factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        Market m = Market(addr);
        assertTrue(factory.isMarket(addr));
        assertEq(factory.marketCount(), 1);
        assertEq(factory.marketAt(0), addr);
        assertEq(uint8(m.status()), uint8(IMarket.Status.Open));
        assertEq(m.probability(0), 5e17);
        assertEq(usdc.balanceOf(addr), SEED + DEPOSIT);
        assertEq(m.creator(), creator);
        // The market must point at the shares instance that genuinely trusts this factory.
        assertEq(address(m.shares()), address(shares));
    }

    /// @dev A market nobody can categorise is one nobody can filter for, no agent
    ///      policy can match, and no category-specific settlement template can reach.
    ///      All three failures are silent, so the typo is refused at creation.
    function test_aMarketCannotBeCreatedUnderAnUnknownCategory() public {
        IMarket.Params memory p = _params();
        p.category = "cyrpto";
        bytes memory sig = _sign(p, 1);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MarketFactory.UnknownCategory.selector, bytes32("cyrpto")));
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
    }

    function test_everyCategoryTheRegistryKnowsCanCreateAMarket() public {
        bytes32[6] memory names = [bytes32("crypto"), "politics", "sports", "economics", "science", "culture"];
        for (uint256 i = 0; i < names.length; i++) {
            IMarket.Params memory p = _params();
            p.category = names[i];
            bytes memory sig = _sign(p, i + 1);
            vm.prank(creator);
            address m = factory.createMarket(p, SEED, DEPOSIT, i + 1, sig);
            assertEq(Market(m).category(), names[i], "the market did not keep its category");
        }
        assertEq(factory.marketCount(), 6, "not every category produced a market");
    }

    function test_marketCanMintSharesOnlyAfterRegistration() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        vm.prank(creator);
        Market m = Market(factory.createMarket(p, SEED, DEPOSIT, 1, sig));

        _fund(alice, 100_000e6, address(m));
        vm.prank(alice);
        m.buy(1, 50e18, type(uint256).max, alice);
        assertEq(shares.balanceOfOutcome(alice, address(m), 1), 50e18);

        // The "ONLY" half: a clone with identical bytecode that did NOT come through the factory
        // must not be able to mint anything. Authorization rests on the registry, not on the
        // bytecode. `Clones.clone` is a CREATE and the funding is an external call — all of it
        // deliberately finished BEFORE `vm.expectRevert` is armed.
        Market rogue = Market(Clones.clone(address(marketImpl)));
        usdc.mintTo(address(rogue), SEED + DEPOSIT);
        rogue.initialize(address(config), address(shares), p, SEED, DEPOSIT);
        assertFalse(factory.isMarket(address(rogue)));
        _fund(bob, 100_000e6, address(rogue));

        vm.prank(bob);
        vm.expectRevert(OutcomeShares.NotMarket.selector);
        rogue.buy(1, 50e18, type(uint256).max, bob);
    }

    function test_wrongSignerRejected() public {
        IMarket.Params memory p = _params();
        bytes32 structHash = _structHash(p, SEED, DEPOSIT, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, factory.hashTypedData(structHash));
        bytes memory forged = abi.encodePacked(r, s, v);
        bytes memory genuine = _sign(p, 1);

        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, forged);

        // Proof that what was rejected is the SIGNER, not the parameters or the nonce: the exact
        // same payload passes as soon as the real curator signs it.
        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, genuine);
        assertEq(factory.marketCount(), 1);
    }

    /// @dev A signature that has been used must not be usable again.
    function test_approvalCannotBeReplayed() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        bytes memory sigNonceTwo = _sign(p, 2);

        vm.startPrank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        vm.expectRevert(MarketFactory.ApprovalAlreadyUsed.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        // Proof that what was rejected is the REUSE, not duplicate params: a fresh approval over
        // the exact same params still passes.
        factory.createMarket(p, SEED, DEPOSIT, 2, sigNonceTwo);
        vm.stopPrank();

        assertEq(factory.marketCount(), 2);
    }

    /// @dev Changing a single field invalidates the signature — the curator approves a
    ///      PARTICULAR market, not a general permission.
    function test_tamperedParamsRejected() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        p.tier = 0;

        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        // Proof that what was rejected is the CHANGE: the same signature passes as soon as the
        // field is put back.
        p.tier = 1;
        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 1);
    }

    function test_createMarketBlockedWhilePaused() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);

        vm.prank(guardian);
        config.pause();
        vm.prank(creator);
        vm.expectRevert(MarketFactory.ProtocolPaused.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        // Proof that what rejected it is the PAUSE, not the signature: the same sig passes once
        // the owner switches things back on.
        config.unpause();
        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 1);
    }

    function test_onlyOwnerCanSwapImplementation() public {
        Market next = new Market();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, alice));
        factory.setMarketImplementation(address(next));
        assertEq(factory.marketImplementation(), address(marketImpl));

        factory.setMarketImplementation(address(next));
        assertEq(factory.marketImplementation(), address(next));
    }

    /// @dev A curator approval is NOT a bearer instrument. The front-runner here is funded and
    ///      FULLY approved — so what rejects them really is the caller's identity, not a failed
    ///      transfer — and the creator's approval survives the attempt.
    function test_onlyApprovedCreatorMayConsumeApproval() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        _fund(bob, 1_000_000e6, address(factory));

        vm.prank(bob);
        vm.expectRevert(MarketFactory.NotCreator.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 1);
    }

    /// @dev A market's opening depth (the DPM `b` parameter) derives entirely from the seed, so
    ///      an approval that does not bind the seed means the curator approved the question but
    ///      not the market. An approval over SEED must not be usable at MIN_SEED.
    function test_seedAndDepositAreBoundBySignature() public {
        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1); // signs (SEED, DEPOSIT)
        uint256 minSeed = config.params(ConfigKeys.MIN_SEED);
        assertLt(minSeed, SEED);

        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, minSeed, DEPOSIT, 1, sig);

        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, SEED, DEPOSIT + 1, 1, sig);

        // Proof that what was rejected is the NUMBERS: the exact signed pair passes.
        vm.prank(creator);
        address m = factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(usdc.balanceOf(m), SEED + DEPOSIT);
    }

    /// @dev `allowedCollateral` is a SET, not a singleton. With two collaterals both allowed, an
    ///      approval that does not bind the token could be used to launch the same spec in a
    ///      different token — with a different `scale` and a different economic profile. The
    ///      second token here IS already allowed, so what rejects it must be the signature and
    ///      not the allowlist.
    function test_collateralIsBoundBySignature() public {
        MockUSDC other = new MockUSDC();
        config.setCollateralAllowed(address(other), true);
        other.mintTo(creator, 1_000_000e6);
        vm.prank(creator);
        other.approve(address(factory), type(uint256).max);

        IMarket.Params memory p = _params(); // collateral = usdc
        bytes memory sig = _sign(p, 1);

        p.collateral = address(other);
        vm.prank(creator);
        vm.expectRevert(MarketFactory.BadCuratorSignature.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        p.collateral = address(usdc);
        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 1);
    }

    /// @dev Collateral outside the allowlist is rejected at the FACTORY, not only later in
    ///      Market.initialize. An honest note: a revert rolls back all state, so `marketCount()`
    ///      and `usedApprovals` below could not hold any other value as long as this path
    ///      reverts — both are placed as regression guards in case that guard is ever replaced
    ///      by a path that does NOT revert. What proves the approval is intact is the last line:
    ///      the SAME signature still works once the token is allowed.
    function test_unlistedCollateralRejectedAndApprovalSurvives() public {
        MockUSDC other = new MockUSDC();
        other.mintTo(creator, 1_000_000e6);
        vm.prank(creator);
        other.approve(address(factory), type(uint256).max);

        IMarket.Params memory p = _params();
        p.collateral = address(other);
        bytes memory sig = _sign(p, 1);
        bytes32 digest = factory.hashTypedData(_structHash(p, SEED, DEPOSIT, 1));

        vm.prank(creator);
        vm.expectRevert(MarketFactory.CollateralNotAllowlisted.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 0);
        assertFalse(factory.usedApprovals(digest));

        config.setCollateralAllowed(address(other), true);
        vm.prank(creator);
        address m = factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(other.balanceOf(m), SEED + DEPOSIT);
    }

    /// @dev Proves the ORDER, not merely that a guard exists: the collateral is an address with
    ///      NO CODE. Had `safeTransferFrom` been reached, OZ `Address` would revert
    ///      `AddressEmptyCode`, not `CollateralNotAllowed`. The `CollateralNotAllowed()`
    ///      selector is identical to `Market`'s (selectors are computed from the signature), so
    ///      it is this codeless address that separates "checked at the factory" from "checked in
    ///      Market".
    function test_collateralCheckedBeforeTouchingToken() public {
        IMarket.Params memory p = _params();
        p.collateral = makeAddr("a token that was never deployed");
        bytes memory sig = _sign(p, 1);

        vm.prank(creator);
        vm.expectRevert(MarketFactory.CollateralNotAllowlisted.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 0);
    }

    /// @dev Both write paths to `marketImplementation` — and the two other collaborator
    ///      addresses — reject codeless addresses. See `MarketFactory.NotAContract` for why a
    ///      codeless address is specifically dangerous here.
    function test_codelessAddressesRejectedOnEveryWritePath() public {
        address ghost = makeAddr("not deployed yet");
        bytes memory expected = abi.encodeWithSelector(MarketFactory.NotAContract.selector, ghost);

        vm.expectRevert(expected);
        factory.setMarketImplementation(ghost);
        assertEq(factory.marketImplementation(), address(marketImpl));

        // A proxy with no initialization data, so `initialize` can be bound as an external call
        // of its own instead of being buried inside a CREATE.
        MarketFactory raw = MarketFactory(address(new ERC1967Proxy(address(new MarketFactory()), "")));

        vm.expectRevert(expected);
        raw.initialize(address(this), ghost, address(shares), address(marketImpl));
        vm.expectRevert(expected);
        raw.initialize(address(this), address(config), ghost, address(marketImpl));
        vm.expectRevert(expected);
        raw.initialize(address(this), address(config), address(shares), ghost);

        raw.initialize(address(this), address(config), address(shares), address(marketImpl));
        assertEq(raw.marketImplementation(), address(marketImpl));
    }

    /// @dev The last guard, at the point of cloning. `Clones.clone` over a codeless address
    ///      produces a minimal proxy that is LIVE: `Market(clone).initialize(...)` "succeeds"
    ///      silently (a delegatecall into nothing returns success + empty returndata, and
    ///      initialize has no return value to decode) after the user's collateral has already
    ///      moved into a clone that is permanently dead. Both setters already close the normal
    ///      routes into this state, so the slot is forced through `vm.store` — the `assertEq`
    ///      below makes sure that write really did land on `marketImplementation`, so this test
    ///      cannot pass by accidentally writing the wrong slot.
    function test_createMarketRefusesCodelessImplementation() public {
        address ghost = makeAddr("ghost implementation");
        vm.store(address(factory), bytes32(uint256(2)), bytes32(uint256(uint160(ghost))));
        assertEq(factory.marketImplementation(), ghost);

        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MarketFactory.NotAContract.selector, ghost));
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(factory.marketCount(), 0);
    }

    /// @dev The EIP-712 domain is the contract between the off-chain signer (the Curator agent)
    ///      and on-chain verification. The digest is recomputed here from scratch so that a
    ///      typo in name/version cannot slip through unnoticed and kill the entire
    ///      market-creation flow in production.
    function test_typedDataDigestMatchesEip712() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = factory.eip712Domain();
        assertEq(name, "Brier");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(factory));

        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Brier")),
                keccak256(bytes("1")),
                block.chainid,
                address(factory)
            )
        );
        bytes32 structHash = keccak256("any struct at all");
        assertEq(factory.hashTypedData(structHash), keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash)));
    }

    /// @dev The two errors used to be indistinguishable. `MarketFactory` and `Market` each
    ///      declared `CollateralNotAllowed()`, and a Solidity error selector is derived from
    ///      the signature alone — so both were 0x00413389, and a test asserting the factory
    ///      rejected a market would have passed just as happily had `Market.initialize`
    ///      rejected it one external call later. The ordering is the whole point of
    ///      `test_collateralCheckedBeforeTouchingToken`, so the two must not collide.
    function test_factoryAndMarketCollateralErrorsAreDistinguishable() public pure {
        assertTrue(
            MarketFactory.CollateralNotAllowlisted.selector != Market.CollateralNotAllowed.selector,
            "the factory and the market must be tellable apart on the wire"
        );
    }

    /// @dev `createMarket` writes `usedApprovals`, `isMarket` and `_markets`, and only then
    ///      calls out — to `safeTransferFrom` on a token address the caller chose, and to
    ///      `Market.initialize`. The Task 17 reviewer traced the re-entry paths and found none
    ///      live, which made this fragile rather than broken. `nonReentrant` closes it; this
    ///      test is what shows the modifier is load-bearing rather than decorative.
    ///
    ///      The inner call is made FULLY VALID — its own curator signature, its own nonce, its
    ///      own funded creator — so that without the guard it would genuinely succeed. If the
    ///      inner call could only ever have failed for some other reason, the test would prove
    ///      nothing about reentrancy.
    function test_createMarketRejectsReentryFromTheCollateralToken() public {
        ReentrantCollateral evil = new ReentrantCollateral();
        config.setCollateralAllowed(address(evil), true);

        IMarket.Params memory outer = _params();
        outer.collateral = address(evil);
        bytes memory outerSig = _sign(outer, 1);

        // The re-entrant call arrives with the TOKEN as msg.sender, so the market it tries to
        // create must name the token as its creator — otherwise `NotCreator` would stop it
        // before the guard ever ran, and the guard would go untested.
        IMarket.Params memory inner = _params();
        inner.collateral = address(evil);
        inner.creator = address(evil);
        bytes memory innerSig = _signAmounts(inner, SEED, DEPOSIT, 2);

        evil.mintTo(creator, 1_000_000e18);
        evil.mintTo(address(evil), 1_000_000e18);
        vm.prank(creator);
        evil.approve(address(factory), type(uint256).max);
        vm.prank(address(evil));
        evil.approve(address(factory), type(uint256).max);

        evil.arm(factory, inner, SEED, DEPOSIT, 2, innerSig);

        vm.prank(creator);
        factory.createMarket(outer, SEED, DEPOSIT, 1, outerSig);

        assertFalse(evil.reentryReturned(), "the re-entrant createMarket must not have returned a market");
        assertEq(
            bytes4(evil.lastRevert()),
            ReentrancyGuardUpgradeable.ReentrancyGuardReentrantCall.selector,
            "the re-entry must be stopped by the reentrancy guard, not by something incidental"
        );
        assertEq(factory.marketCount(), 1, "exactly one market exists");
    }

    // ── the identity a market credits itself to ───────────────────────────────

    /**
     * `creatorAgentId` was written to storage and emitted in `MarketCreated` with nothing
     * checking it. The curator signature covers the field, but a curator attesting to
     * "creator X, agent 7" does not make X own agent 7. On Galileo a market created by the
     * deployer credited itself to agent 1, which belongs to a different wallet, and the chain
     * recorded that as fact — so any reputation counted off the field was reputation anyone
     * could mint by typing a different number.
     */
    function test_creatorCannotClaimAnAgentItDoesNotOwn() public {
        IMarket.Params memory p = _params();
        // Alice owns agent 2. `creator` owns agent 1 and is the one signing and paying.
        vm.prank(alice);
        uint256 hers = agents.register(IAgentRegistry.Role.Creator, address(0), "alice-one", bytes32(0));
        p.creatorAgentId = hers;

        bytes memory sig = _sign(p, 1);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(MarketFactory.NotAgentOwner.selector, hers, creator));
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
    }

    /// @dev A curator approval does not launder the claim: the signature here is perfectly
    ///      valid over exactly these params, and the market is still refused.
    function test_aValidCuratorApprovalDoesNotMakeTheClaimTrue() public {
        IMarket.Params memory p = _params();
        p.creatorAgentId = 99; // never minted
        bytes memory sig = _sign(p, 1);

        vm.prank(creator);
        vm.expectRevert(); // ownerOf on a nonexistent id — the right answer to a claim on nothing
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);
    }

    /**
     * Zero is not a claim. Agent ids start at 1, so 0 is the registry's own sentinel for
     * "none", and a creator with no agent should be able to open a market crediting nobody
     * rather than be forced to mint an identity first. What is refused is claiming an
     * identity that is not yours — not declining to claim one.
     */
    function test_aMarketMayCreditNobody() public {
        IMarket.Params memory p = _params();
        p.creatorAgentId = 0;
        bytes memory sig = _sign(p, 1);

        vm.prank(creator);
        address market = factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(Market(market).creatorAgentId(), 0, "credited to nobody");
    }

    /**
     * The operator key counts as the agent's own hand. `agentOf` exists precisely to answer
     * "which agent does this key act for", and requiring the NFT holder alone would force a
     * key kept in cold storage to sign every market creation.
     */
    function test_theOperatorKeyMayCreateOnTheAgentsBehalf() public {
        // Alice holds the NFT; bob is the key that acts for it.
        vm.prank(alice);
        uint256 id = agents.register(IAgentRegistry.Role.Creator, bob, "cold-storage", bytes32(0));
        assertEq(agents.agentOf(bob), id, "bob operates it");

        IMarket.Params memory p = _params();
        p.creator = bob;
        p.creatorAgentId = id;
        bytes memory sig = _sign(p, 1);

        _fund(bob, 1_000_000e6, address(factory));
        vm.prank(bob);
        address market = factory.createMarket(p, SEED, DEPOSIT, 1, sig);
        assertEq(Market(market).creatorAgentId(), id, "credited to the agent it operates");
    }

    /**
     * An identity claimed where nothing can check it is refused, not waved through. An
     * unverifiable claim recorded on chain is worth less than no claim at all, because on
     * screen it looks exactly like a verified one — which is the whole defect being repaired.
     */
    function test_anUncheckableClaimIsRefusedRatherThanTrusted() public {
        config.setAddress(ConfigKeys.AGENT_REGISTRY, address(0));

        IMarket.Params memory p = _params();
        bytes memory sig = _sign(p, 1);
        vm.prank(creator);
        vm.expectRevert(MarketFactory.AgentRegistryUnset.selector);
        factory.createMarket(p, SEED, DEPOSIT, 1, sig);

        // …but a market crediting nobody still opens, because it claims nothing.
        p.creatorAgentId = 0;
        bytes memory none = _sign(p, 2);
        vm.prank(creator);
        factory.createMarket(p, SEED, DEPOSIT, 2, none);
    }
}
