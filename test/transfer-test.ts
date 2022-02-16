import { baseBalanceOf, event, expect, exp, makeProtocol, portfolio, setTotalsBasic, wait } from './helpers';

describe('transfer', function () {
  it('transfers base from sender if the asset is base', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      tokens,
      users: [alice, bob],
    } = protocol;
    const { USDC } = tokens;

    const _i0 = await comet.setBasePrincipal(bob.address, 100e6);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsBasic();
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsB.transferAsset(alice.address, USDC.address, 100e6));
    const t1 = await comet.totalsBasic();
    const p1 = await portfolio(protocol, alice.address);
    const q1 = await portfolio(protocol, bob.address);

    expect(event(s0, 0)).to.be.deep.equal({
      Transfer: {
        from: bob.address,
        to: alice.address,
        amount: BigInt(100e6),
      }
    });

    expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(p1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
    expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(90000);
  });

  it('transfers collateral from sender if the asset is collateral', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      tokens,
      users: [alice, bob],
    } = protocol;
    const { COMP } = tokens;

    const _i0 = await comet.setCollateralBalance(bob.address, COMP.address, 8e8);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsCollateral(COMP.address);
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsB.transferAsset(alice.address, COMP.address, 8e8));
    const t1 = await comet.totalsCollateral(COMP.address);
    const p1 = await portfolio(protocol, alice.address);
    const q1 = await portfolio(protocol, bob.address);

    expect(event(s0, 0)).to.be.deep.equal({
      TransferCollateral: {
        from: bob.address,
        to: alice.address,
        asset: COMP.address,
        amount: BigInt(8e8),
      }
    });

    expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
    expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
    expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(t1.totalSupplyAsset).to.be.equal(t0.totalSupplyAsset);
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(95000);
  });

  it('calculates base principal correctly', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await comet.setBasePrincipal(bob.address, 50e6); // 100e6 in present value
    const cometAsB = comet.connect(bob);

    const totals0 = await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
    });

    const alice0 = await portfolio(protocol, alice.address);
    const bob0 = await portfolio(protocol, bob.address);

<<<<<<< HEAD
    await wait(cometAsB.transferAsset(alice.address, USDC.address, 100e6));
=======
    await wait(cometAsB.transfer(alice.address, USDC.address, 100e6));
>>>>>>> 4db1033 (Trim revert strings)
    const totals1 = await comet.totalsBasic();
    const alice1 = await portfolio(protocol, alice.address);
    const bob1 = await portfolio(protocol, bob.address);

    expect(alice0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(bob0.internal).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(alice1.internal).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(bob1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(totals1.totalSupplyBase).to.be.equal(totals0.totalSupplyBase);
    expect(totals1.totalBorrowBase).to.be.equal(totals0.totalBorrowBase);
  });

  it('reverts if the asset is neither collateral nor base', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      users: [alice, bob],
      unsupportedToken: USUP,
    } = protocol;

    const cometAsB = comet.connect(bob);

    await expect(cometAsB.transferAsset(alice.address, USUP.address, 1)).to.be.reverted;
  });

  it('reverts if transfer is paused', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, pauseGuardian, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    const cometAsB = comet.connect(bob);

    // Pause transfer
    await wait(comet.connect(pauseGuardian).pause(false, true, false, false, false));
    expect(await comet.isTransferPaused()).to.be.true;

<<<<<<< HEAD
    await expect(cometAsB.transferAsset(alice.address, USDC.address, 1)).to.be.revertedWith("custom error 'Paused()'");
=======
    await expect(cometAsB.transfer(alice.address, USDC.address, 1)).to.be.revertedWith('paused');
>>>>>>> 4db1033 (Trim revert strings)
  });

  it('borrows base if collateralized', async () => {
    const { comet, tokens, users: [alice, bob]} = await makeProtocol();
    const { WETH, USDC } = tokens;

    await comet.setCollateralBalance(alice.address, WETH.address, exp(1,18));

    let t0 = await comet.totalsBasic();
    await setTotalsBasic(comet, {
      baseBorrowIndex: t0.baseBorrowIndex.mul(2),
    });

    await comet.connect(alice).transferAsset(bob.address, USDC.address, 100e6);

    expect(await baseBalanceOf(comet, alice.address)).to.eq(BigInt(-100e6));
  });

  it('cant borrow less than the minimum', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      tokens,
      users: [alice, bob],
    } = protocol;
    const { USDC } = tokens;

    const cometAsB = comet.connect(bob);

    const amount = (await comet.baseBorrowMin()).sub(1);
    await expect(cometAsB.transferAsset(alice.address, USDC.address, amount)).to.be.revertedWith(
      "custom error 'BorrowTooSmall()'"
    );
  });

  it('reverts on self-transfer of base token', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol({ base: 'USDC' });
    const { USDC } = tokens;

    await expect(
<<<<<<< HEAD
      comet.connect(alice).transferAsset(alice.address, USDC.address, 100)
    ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
=======
      comet.connect(alice).transfer(alice.address, USDC.address, 100)
    ).to.be.revertedWith('no self-transfer');
>>>>>>> 4db1033 (Trim revert strings)
  });

  it('reverts on self-transfer of collateral', async () => {
    const {
      comet,
      tokens,
      users: [alice],
    } = await makeProtocol();
    const { COMP } = tokens;

    await expect(
<<<<<<< HEAD
      comet.connect(alice).transferAsset(alice.address, COMP.address, 100)
    ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
  });

  it('reverts if transferring base results in an under collateralized borrow', async () => {
    const { comet, tokens, users: [alice, bob]} = await makeProtocol();
    const { USDC } = tokens;

    await expect(
      comet.connect(alice).transferAsset(bob.address, USDC.address, 100e6)
    ).to.be.revertedWith("custom error 'NotCollateralized()'");
  });

  it('reverts if transferring collateral results in an under collateralized borrow', async () => {
    const { comet, tokens, users: [alice, bob]} = await makeProtocol();
    const { WETH } = tokens;

    // user has a borrow, but with collateral to cover
    await comet.setBasePrincipal(alice.address, -100e6);
    await comet.setCollateralBalance(alice.address, WETH.address, exp(1,18));

    // reverts if transfer would leave the borrow uncollateralized
    await expect(
      comet.connect(alice).transferAsset(bob.address, WETH.address, exp(1,18))
    ).to.be.revertedWith("custom error 'NotCollateralized()'");
=======
      comet.connect(alice).transfer(alice.address, COMP.address, 100)
    ).to.be.revertedWith('no self-transfer');
>>>>>>> 4db1033 (Trim revert strings)
  });
});

describe('transferFrom', function () {
  it('transfers from src if specified and sender has permission', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      cometExt,
      tokens,
      users: [alice, bob, charlie],
    } = protocol;
    const { COMP } = tokens;

<<<<<<< HEAD
    const _i0 = await comet.setCollateralBalance(bob.address, COMP.address, 7);
    const cometAsB = comet.connect(bob);
=======
    const i0 = await comet.setCollateralBalance(bob.address, COMP.address, 7);
    const cometAsB = cometExt.connect(bob);
>>>>>>> 5b6a66a (Actually add extension delegate)
    const cometAsC = comet.connect(charlie);

    const _a1 = await wait(cometAsB.allow(charlie.address, true));
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const _s0 = await wait(cometAsC.transferAssetFrom(bob.address, alice.address, COMP.address, 7));
    const p1 = await portfolio(protocol, alice.address);
    const q1 = await portfolio(protocol, bob.address);

    expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n });
    expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n });
    expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  });

  it('reverts if src is specified and sender does not have permission', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      tokens,
      users: [alice, bob, charlie],
    } = protocol;
    const { COMP } = tokens;

    const _i0 = await comet.setCollateralBalance(bob.address, COMP.address, 7);
    const cometAsC = comet.connect(charlie);

    await expect(
<<<<<<< HEAD
      cometAsC.transferAssetFrom(bob.address, alice.address, COMP.address, 7)
    ).to.be.revertedWith("custom error 'Unauthorized()'");
=======
      cometAsC.transferFrom(bob.address, alice.address, COMP.address, 7)
    ).to.be.revertedWith('bad auth');
>>>>>>> 4db1033 (Trim revert strings)
  });

  it('reverts on transfer of base token from address to itself', async () => {
    const {
      comet,
      cometExt,
      tokens,
      users: [alice, bob],
    } = await makeProtocol({ base: 'USDC' });
    const { USDC } = tokens;

    await cometExt.connect(bob).allow(alice.address, true);

    await expect(
<<<<<<< HEAD
      comet.connect(alice).transferAssetFrom(bob.address, bob.address, USDC.address, 100)
    ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
=======
      comet.connect(alice).transferFrom(bob.address, bob.address, USDC.address, 100)
    ).to.be.revertedWith('no self-transfer');
>>>>>>> 4db1033 (Trim revert strings)
  });

  it('reverts on transfer of collateral from address to itself', async () => {
    const {
      comet,
      cometExt,
      tokens,
      users: [alice, bob],
    } = await makeProtocol();
    const { COMP } = tokens;

    await cometExt.connect(bob).allow(alice.address, true);

    await expect(
<<<<<<< HEAD
      comet.connect(alice).transferAssetFrom(bob.address, bob.address, COMP.address, 100)
    ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
=======
      comet.connect(alice).transferFrom(bob.address, bob.address, COMP.address, 100)
    ).to.be.revertedWith('no self-transfer');
>>>>>>> 4db1033 (Trim revert strings)
  });

  it('reverts if transfer is paused', async () => {
    const protocol = await makeProtocol();
    const { comet, cometExt, tokens, pauseGuardian, users: [alice, bob, charlie] } = protocol;
    const { COMP } = tokens;

    await comet.setCollateralBalance(bob.address, COMP.address, 7);
    const cometAsB = cometExt.connect(bob);
    const cometAsC = comet.connect(charlie);

    // Pause transfer
    await wait(comet.connect(pauseGuardian).pause(false, true, false, false, false));
    expect(await comet.isTransferPaused()).to.be.true;

    await wait(cometAsB.allow(charlie.address, true));
<<<<<<< HEAD
    await expect(cometAsC.transferAssetFrom(bob.address, alice.address, COMP.address, 7)).to.be.revertedWith("custom error 'Paused()'");
=======
    await expect(cometAsC.transferFrom(bob.address, alice.address, COMP.address, 7)).to.be.revertedWith('paused');
>>>>>>> 4db1033 (Trim revert strings)
  });
});
