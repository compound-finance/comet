import { Comet, ethers, expect, exp, makeProtocol, portfolio, wait } from './helpers';

describe('buyCollateral', function () {
  it('allows buying collateral when reserves < target reserves', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 100});
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Reserves are at 0

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 100);
    await COMP.allocateTo(comet.address, 100);
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: 100, _reserved: 0 }));
    await wait(comet.setCollateralBalance(comet.address, COMP.address, 100));

    const r0 = await comet.getReserves();
    const p0 = await portfolio(protocol, alice.address);
    await wait(baseAsA.approve(comet.address, 50));
    // Alice buys 50 COMP for 50 USDC
    await wait(cometAsA.buyCollateral(COMP.address, 50, 50, alice.address));
    const p1 = await portfolio(protocol, alice.address)
    const r1 = await comet.getReserves();

    expect(r0).to.be.equal(0n);
    expect(r0).to.be.lt(await comet.targetReserves());
    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p0.external).to.be.deep.equal({USDC: 100n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.external).to.be.deep.equal({USDC: 50n, COMP: 50n, WETH: 0n, WBTC: 0n});
    expect(r1).to.be.equal(50n);
  });

  it('allows buying collateral when reserves < 0 and target reserves is 0', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 0});
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Set reserves to -100
    let t0 = await comet.totalsBasic();
    t0 = Object.assign({}, t0, {
        totalSupplyBase: 100n,
        totalBorrowBase: 0n,
    });
    await wait(comet.setTotalsBasic(t0));

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 100);
    await COMP.allocateTo(comet.address, 100);
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: 100, _reserved: 0 }));
    await wait(comet.setCollateralBalance(comet.address, COMP.address, 100));

    const r0 = await comet.getReserves();
    const p0 = await portfolio(protocol, alice.address);
    await wait(baseAsA.approve(comet.address, 50));
    // Alice buys 50 COMP for 50 USDC
    await wait(cometAsA.buyCollateral(COMP.address, 50, 50, alice.address));
    const p1 = await portfolio(protocol, alice.address)
    const r1 = await comet.getReserves();

    expect(r0).to.be.equal(-100n);
    expect(r0).to.be.lt(await comet.targetReserves());
    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p0.external).to.be.deep.equal({USDC: 100n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.external).to.be.deep.equal({USDC: 50n, COMP: 50n, WETH: 0n, WBTC: 0n});
    expect(r1).to.be.equal(-50n);
  });

  it('reverts if reserves are above target reserves', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 0});
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Set reserves to 100
    await USDC.allocateTo(comet.address, 100);

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 100);
    await COMP.allocateTo(comet.address, 100);
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: 100, _reserved: 0 }));
    await wait(comet.setCollateralBalance(comet.address, COMP.address, 100));

    const r0 = await comet.getReserves();
    expect(r0).to.be.equal(100n); 
    expect(r0).to.be.gt(await comet.targetReserves());
    
    // Alice buys 50 COMP for 50 USDC    
    await wait(baseAsA.approve(comet.address, 50));
    await expect(cometAsA.buyCollateral(COMP.address, 50, 50, alice.address)).to.be.revertedWith('no ongoing sale');
  });

  it('reverts if slippage is too high', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 100});
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Reserves are at 0

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 100);
    await COMP.allocateTo(comet.address, 100);
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: 100, _reserved: 0 }));
    await wait(comet.setCollateralBalance(comet.address, COMP.address, 100));

    // Alice tries to buy 100 COMP for 50 USDC
    await wait(baseAsA.approve(comet.address, 50));
    await expect(cometAsA.buyCollateral(COMP.address, 100, 50, alice.address)).to.be.revertedWith('slippage too high');
  });

  it('reverts if not enough collateral to buy', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 100});
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Reserves are at 0

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 200);
    await COMP.allocateTo(comet.address, 100);
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: 100, _reserved: 0 }));
    await wait(comet.setCollateralBalance(comet.address, COMP.address, 100));

    // Alice tries to buy 200 COMP for 200 USDC
    await wait(baseAsA.approve(comet.address, 200));
    await expect(cometAsA.buyCollateral(COMP.address, 200, 200, alice.address)).to.be.revertedWith('reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');
  });

  it.skip('buys the correct amount in a fee-like situation', async () => {
    // XXX
  });

  it.skip('is not broken by malicious re-entrancy', async () => {
    // XXX
  });
});
