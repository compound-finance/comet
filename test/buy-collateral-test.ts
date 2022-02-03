import { Comet, ethers, expect, exp, makeProtocol, portfolio, wait } from './helpers';

describe('buyCollateral', function () {
  it('allows buying collateral when reserves < target reserves', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 100, 
      assets: {
        USDC: {
          initial: 1e6,
          decimals: 6,
          initialPrice: 1,
        },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
        },
      }
    });  
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Reserves are at 0 wei

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 100e6);
    await COMP.allocateTo(comet.address, exp(50, 18));
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: exp(50, 18), _reserved: 0 }));
    await wait(comet.setCollateralBalance(comet.address, COMP.address, exp(50, 18)));

    const r0 = await comet.getReserves();
    const p0 = await portfolio(protocol, alice.address);
    await wait(baseAsA.approve(comet.address, exp(50, 6)));
    // Alice buys 50e18 wei COMP for 50e6 wei USDC
    await wait(cometAsA.buyCollateral(COMP.address, exp(50, 18), 50e6, alice.address));
    const p1 = await portfolio(protocol, alice.address)
    const r1 = await comet.getReserves();

    expect(r0).to.be.equal(0n);
    expect(r0).to.be.lt(await comet.targetReserves());
    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n});
    expect(p0.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n});
    expect(p1.external).to.be.deep.equal({USDC: exp(50, 6), COMP: exp(50, 18)});
    expect(r1).to.be.equal(exp(50, 6));
  });

  it('allows buying collateral when reserves < 0 and target reserves is 0', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 0,
      assets: {
        USDC: {
          initial: 1e6,
          decimals: 6,
          initialPrice: 1,
        },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
        },
      }
    });
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Set reserves to -100 wei
    let t0 = await comet.totalsBasic();
    t0 = Object.assign({}, t0, {
        totalSupplyBase: 100e6,
        totalBorrowBase: 0n,
    });
    await wait(comet.setTotalsBasic(t0));

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 100e6);
    await COMP.allocateTo(comet.address, exp(50, 18));
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: exp(50, 18), _reserved: 0 }));
    await wait(comet.setCollateralBalance(comet.address, COMP.address, exp(50, 18)));

    const r0 = await comet.getReserves();
    const p0 = await portfolio(protocol, alice.address);
    await wait(baseAsA.approve(comet.address, exp(50, 6)));
    // Alice buys 50e18 wei COMP for 50e6 wei USDC
    await wait(cometAsA.buyCollateral(COMP.address, exp(50, 18), 50e6, alice.address));
    const p1 = await portfolio(protocol, alice.address)
    const r1 = await comet.getReserves();

    expect(r0).to.be.equal(-100e6);
    expect(r0).to.be.lt(await comet.targetReserves());
    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n});
    expect(p0.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n});
    expect(p1.external).to.be.deep.equal({USDC: exp(50, 6), COMP: exp(50, 18)});
    expect(r1).to.be.equal(-50e6);
  });

  it('reverts if reserves are above target reserves', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 0});
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Set reserves to 100e6 wei
    await USDC.allocateTo(comet.address, 100e6);

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 100e6);
    await COMP.allocateTo(comet.address, exp(50, 18));
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: exp(50, 18), _reserved: 0 }));
    await wait(comet.setCollateralBalance(comet.address, COMP.address, exp(50, 18)));

    const r0 = await comet.getReserves();
    expect(r0).to.be.equal(100e6); 
    expect(r0).to.be.gt(await comet.targetReserves());
    
    // Alice buys 50e18 wei COMP for 50e6 wei USDC
    await wait(baseAsA.approve(comet.address, exp(50, 6)));
    await expect(cometAsA.buyCollateral(COMP.address, exp(50, 18), 50e6, alice.address)).to.be.revertedWith('no ongoing sale');
  });

  it('reverts if slippage is too high', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 100,
      assets: {
        USDC: {
          initial: 1e6,
          decimals: 6,
          initialPrice: 1,
        },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
        },
      }
    });
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Reserves are at 0 wei

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 100e6);
    await COMP.allocateTo(comet.address, exp(50, 18));
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: exp(50, 18), _reserved: 0 }));
    await wait(comet.setCollateralBalance(comet.address, COMP.address, exp(50, 18)));

    // Alice tries to buy 100e18 wei COMP for 50e6 wei USDC
    await wait(baseAsA.approve(comet.address, exp(50, 6)));
    await expect(cometAsA.buyCollateral(COMP.address, exp(100, 18), 50e6, alice.address)).to.be.revertedWith('slippage too high');
  });

  it('reverts if not enough collateral to buy', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 100,
      assets: {
        USDC: {
          initial: 1e6,
          decimals: 6,
          initialPrice: 1,
        },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
        },
      }
    });
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Reserves are at 0 wei

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 200e6);
    await COMP.allocateTo(comet.address, exp(50, 18));
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: exp(50, 18), _reserved: 0 }));
    await wait(comet.setCollateralBalance(comet.address, COMP.address, exp(50, 18)));

    // Alice tries to buy 200e18 wei COMP for 200e6 wei USDC
    await wait(baseAsA.approve(comet.address, exp(50, 6)));
    await expect(cometAsA.buyCollateral(COMP.address, exp(200, 18), 200e6, alice.address)).to.be.revertedWith('reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');
  });

  it('reverts if buy is paused', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 0});
    const { comet, tokens, pauseGuardian, users: [alice] } = protocol;
    const { COMP } = tokens;
    const cometAsA = comet.connect(alice);

    // Pause buy collateral
    await wait(comet.connect(pauseGuardian).pause(false, false, false, false, true));
    expect(await comet.isBuyPaused()).to.be.true;
    
    await expect(cometAsA.buyCollateral(COMP.address, exp(50, 18), 50e6, alice.address)).to.be.revertedWith('buy is paused');
  });

  it.skip('buys the correct amount in a fee-like situation', async () => {
    // XXX
  });

  it.skip('is not broken by malicious re-entrancy', async () => {
    // XXX
  });
});
