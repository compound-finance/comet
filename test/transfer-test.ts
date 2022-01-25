import { Comet, ethers, expect, exp, makeProtocol, portfolio, wait } from './helpers';

describe('transfer', function () {
  it('transfers base from sender if the asset is base', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const {
      comet,
      tokens,
      users: [alice, bob],
    } = protocol;
    const { USDC } = tokens;

    const i0 = await comet.setBasePrincipal(bob.address, 100e6);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsBasic();
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsB.transfer(alice.address, USDC.address, 100e6));
    const t1 = await comet.totalsBasic();
    const p1 = await portfolio(protocol, alice.address);
    const q1 = await portfolio(protocol, bob.address);

    expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(p1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
    expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
    // XXX disable during coverage?
    //expect(Number(s0.receipt.gasUsed)).to.be.lessThan(80000);
  });

  it('transfers collateral from sender if the asset is collateral', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      tokens,
      users: [alice, bob],
    } = protocol;
    const { COMP } = tokens;

    const i0 = await comet.setCollateralBalance(bob.address, COMP.address, 8e8);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsCollateral(COMP.address);
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsB.transfer(alice.address, COMP.address, 8e8));
    const t1 = await comet.totalsCollateral(COMP.address);
    const p1 = await portfolio(protocol, alice.address);
    const q1 = await portfolio(protocol, bob.address);

    expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
    expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
    expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(t1.totalSupplyAsset).to.be.equal(t0.totalSupplyAsset);
    // XXX disable during coverage?
    //expect(Number(s0.receipt.gasUsed)).to.be.lessThan(50000);
  });

  it('reverts if the asset is neither collateral nor base', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      users: [alice, bob],
      unsupportedToken: USUP,
    } = protocol;

    const cometAsB = comet.connect(bob);

    await expect(cometAsB.transfer(alice.address, USUP.address, 1)).to.be.reverted;
  });

  it.skip('reverts if transferring base results in an under collateralized borrow', async () => {
    // XXX
  });

  it.skip('borrows base if collateralized', async () => {
    // XXX
  });

  it.skip('reverts if transferring collateral results in an under collateralized borrow', async () => {
    // XXX
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
    await expect(cometAsB.transfer(alice.address, USDC.address, amount)).to.be.revertedWith(
      'borrow too small'
    );
  });
});

describe('transferFrom', function () {
  it('transfers from src if specified and sender has permission', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      tokens,
      users: [alice, bob, charlie],
    } = protocol;
    const { COMP } = tokens;

    const i0 = await comet.setCollateralBalance(bob.address, COMP.address, 7);
    const cometAsB = comet.connect(bob);
    const cometAsC = comet.connect(charlie);

    const a1 = await wait(cometAsB.allow(charlie.address, true));
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsC.transferFrom(bob.address, alice.address, COMP.address, 7));
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

    const i0 = await comet.setCollateralBalance(bob.address, COMP.address, 7);
    const cometAsC = comet.connect(charlie);

    await expect(
      cometAsC.transferFrom(bob.address, alice.address, COMP.address, 7)
    ).to.be.revertedWith('operator not permitted');
  });
});
