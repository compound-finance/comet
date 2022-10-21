import { EvilToken, EvilToken__factory, FaucetToken } from '../build/types';
import { ethers, event, expect, exp, getBlock, makeProtocol, portfolio, ReentryAttack, wait } from './helpers';

describe('buyCollateral', function () {
  it('allows buying collateral when reserves < target reserves', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      storeFrontPriceFactor: exp(0.5, 18),
      targetReserves: 100,
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
          liquidationFactor: exp(0.8, 18),
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
    await COMP.allocateTo(comet.address, exp(60, 18));

    const r0 = await comet.getReserves();
    const p0 = await portfolio(protocol, alice.address);
    await wait(baseAsA.approve(comet.address, exp(50, 6)));
    // Alice buys 50e6 wei USDC worth of COMP
    const txn = await wait(cometAsA.buyCollateral(COMP.address, exp(50, 18), 50e6, alice.address));
    const p1 = await portfolio(protocol, alice.address);
    const r1 = await comet.getReserves();

    expect(r0).to.be.equal(0n);
    expect(r0).to.be.lt(await comet.targetReserves());
    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n});
    expect(p0.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n});
    expect(p1.external).to.be.deep.equal({USDC: exp(50, 6), COMP: 55555555555555555555n});
    expect(r1).to.be.equal(exp(50, 6));
    expect(event(txn, 0)).to.be.deep.equal({
      Transfer: {
        from: alice.address,
        to: comet.address,
        amount: exp(50, 6),
      }
    });
    expect(event(txn, 1)).to.be.deep.equal({
      Transfer: {
        from: comet.address,
        to: alice.address,
        amount: 55555555555555555555n,
      }
    });
    expect(event(txn, 2)).to.be.deep.equal({
      BuyCollateral: {
        buyer: alice.address,
        asset: COMP.address,
        baseAmount: exp(50, 6),
        collateralAmount: 55555555555555555555n,
      }
    });
  });

  it('allows buying collateral when reserves < 0 and target reserves is 0', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      storeFrontPriceFactor: exp(0.5, 18),
      targetReserves: 0,
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
          liquidationFactor: exp(0.8, 18),
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
    await COMP.allocateTo(comet.address, exp(60, 18));

    const r0 = await comet.getReserves();
    const p0 = await portfolio(protocol, alice.address);
    await wait(baseAsA.approve(comet.address, exp(50, 6)));
    // Alice buys 50e6 wei USDC worth of COMP
    const txn = await wait(cometAsA.buyCollateral(COMP.address, exp(50, 18), 50e6, alice.address));
    const p1 = await portfolio(protocol, alice.address);
    const r1 = await comet.getReserves();

    expect(r0).to.be.equal(-100e6);
    expect(r0).to.be.lt(await comet.targetReserves());
    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n});
    expect(p0.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n});
    expect(p1.external).to.be.deep.equal({USDC: exp(50, 6), COMP: 55555555555555555555n});
    expect(r1).to.be.equal(-50e6);
    // Only checking the BuyCollateral event in this test case
    expect(event(txn, 2)).to.be.deep.equal({
      BuyCollateral: {
        buyer: alice.address,
        asset: COMP.address,
        baseAmount: exp(50, 6),
        collateralAmount: 55555555555555555555n,
      }
    });
  });

  it('can buy any excess collateral which does not belong to users', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      storeFrontPriceFactor: exp(0.5, 18),
      targetReserves: exp(100e6, 6),
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
          liquidationFactor: exp(1.0, 18),
        },
      }
    });
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 100e6);
    await COMP.allocateTo(comet.address, exp(60, 18));

    // Give 10 COMP to users, leaving 50 in reserves
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: exp(10, 18), _reserved: 0 }));

    const r0 = await comet.getReserves();
    const p0 = await portfolio(protocol, alice.address);
    await wait(baseAsA.approve(comet.address, exp(50, 6)));
    // Alice buys 50e6 wei USDC worth of COMP
    await wait(cometAsA.buyCollateral(COMP.address, exp(50, 18), 50e6, alice.address));
    const p1 = await portfolio(protocol, alice.address);
    const r1 = await comet.getReserves();

    expect(r0).to.be.equal(0);
    expect(r0).to.be.lt(await comet.targetReserves());
    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n});
    expect(p0.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n});
    expect(p1.external).to.be.deep.equal({USDC: exp(50, 6), COMP: exp(50, 18)});
    expect(r1).to.be.equal(50e6);
  });

  it('reverts if trying to buy collateral which belongs to users', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      storeFrontPriceFactor: exp(0.5, 18),
      targetReserves: exp(100e6, 6),
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
          liquidationFactor: exp(1.0, 18),
        },
      }
    });
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC, COMP } = tokens;
    const cometAsA = comet.connect(alice);
    const baseAsA = USDC.connect(alice);

    // Set up token balances and accounting
    await USDC.allocateTo(alice.address, 100e6);
    await COMP.allocateTo(comet.address, exp(60, 18));

    // Give 20 COMP to users, leaving 40 in reserves
    await wait(comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: exp(20, 18), _reserved: 0 }));

    // Alice attempts to buy 50e6 wei USDC worth of COMP
    await wait(baseAsA.approve(comet.address, exp(50, 6)));
    await expect(cometAsA.buyCollateral(COMP.address, exp(50, 18), 50e6, alice.address)).to.be.revertedWith("custom error 'InsufficientReserves()'");
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
    await expect(cometAsA.buyCollateral(COMP.address, exp(50, 18), 50e6, alice.address)).to.be.revertedWith("custom error 'NotForSale()'");
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
    await expect(cometAsA.buyCollateral(COMP.address, exp(100, 18), 50e6, alice.address)).to.be.revertedWith("custom error 'TooMuchSlippage()'");
  });

  it('reverts if not enough collateral to buy', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      targetReserves: 100,
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
    await wait(baseAsA.approve(comet.address, exp(200, 6)));
    await expect(cometAsA.buyCollateral(COMP.address, exp(200, 18), 200e6, alice.address)).to.be.revertedWith("custom error 'InsufficientReserves()'");
  });

  it('reverts if buy is paused', async () => {
    const protocol = await makeProtocol({base: 'USDC', targetReserves: 0});
    const { comet, tokens, pauseGuardian, users: [alice] } = protocol;
    const { COMP } = tokens;
    const cometAsA = comet.connect(alice);

    // Pause buy collateral
    await wait(comet.connect(pauseGuardian).pause(false, false, false, false, true));
    expect(await comet.isBuyPaused()).to.be.true;

    await expect(cometAsA.buyCollateral(COMP.address, exp(50, 18), 50e6, alice.address)).to.be.revertedWith("custom error 'Paused()'");
  });

  it.skip('buys the correct amount in a fee-like situation', async () => {
    // Note: fee-tokens are not currently supported (for efficiency) and should not be added
  });

  describe('reentrancy', function() {
    it('is not broken by reentrancy supply ', async () => {
      const wethArgs = {
        initial: 1e4,
        decimals: 18,
        initialPrice: 3000,
      };
      const baseTokenArgs = {
        decimals: 6,
        initial: 1e6,
        initialPrice: 1,
      };

      // 1. normal scenario, USDC base
      const normalProtocol = await makeProtocol({
        base: 'USDC',
        assets: {
          USDC: baseTokenArgs,
          WETH: wethArgs,
        },
        targetReserves: 1
      });
      const {
        comet: normalComet,
        tokens: normalTokens,
        users: [normalAlice, normalBob, evilAlice, evilBob] // addresses are constant
      } = normalProtocol;
      const { USDC: normalUSDC, WETH: normalWETH } = normalTokens;

      // 2. malicious scenario, EVIL token is base
      const evilProtocol = await makeProtocol({
        base: 'EVIL',
        assets: {
          EVIL: {
            ...baseTokenArgs,
            factory: await ethers.getContractFactory('EvilToken') as EvilToken__factory,
          },
          WETH: wethArgs,
        },
        targetReserves: 1
      });
      const {
        comet: evilComet,
        tokens: evilTokens,
      } = evilProtocol;
      const { WETH: evilWETH, EVIL } = <{WETH: FaucetToken, EVIL: EvilToken}>evilTokens;
      // add attack to EVIL token
      const attack = Object.assign({}, await EVIL.getAttack(), {
        attackType: ReentryAttack.SupplyFrom,
        source: evilAlice.address,
        destination: evilBob.address,
        asset: EVIL.address,
        amount: 1e6,
        maxCalls: 1
      });
      await EVIL.setAttack(attack);

      // allocate tokens
      await normalWETH.allocateTo(normalComet.address, exp(100, 18));
      await normalUSDC.allocateTo(normalAlice.address, exp(5000, 6));
      // allocate tokens (evil)
      await evilWETH.allocateTo(evilComet.address, exp(100, 18));
      await EVIL.allocateTo(evilAlice.address, exp(5000, 6));

      // ensure both Comets have the same lastAccrualTime
      const start = (await getBlock()).timestamp;

      let tb0 = await normalComet.totalsBasic();
      tb0 = Object.assign({}, tb0, {
        lastAccrualTime: start
      });
      await normalComet.setTotalsBasic(tb0);

      let tb1 = await evilComet.totalsBasic();
      tb1 = Object.assign({}, tb1, {
        lastAccrualTime: start
      });
      await evilComet.setTotalsBasic(tb1);

      // approve Comet to move funds
      await normalUSDC.connect(normalAlice).approve(normalComet.address, exp(5000, 6));
      await EVIL.connect(evilAlice).approve(EVIL.address, exp(5000, 6));

      // perform the supplies for each protocol in the same block, so that the
      // same amount of time elapses for each when calculating interest
      await ethers.provider.send('evm_setAutomine', [false]);

      // call supply
      await normalComet
        .connect(normalAlice)
        .supplyFrom(
          normalAlice.address,
          normalBob.address,
          normalUSDC.address,
          1e6
        );

      // call buyCollateral
      await normalComet
        .connect(normalAlice)
        .buyCollateral(
          normalWETH.address,
          exp(.5, 18),
          exp(3000, 6),
          normalAlice.address
        );

      // authorize EVIL, since callback will originate from EVIL token address
      await evilComet.connect(evilAlice).allow(EVIL.address, true);
      // call buyCollateral; supplyFrom is called in in callback
      await evilComet
        .connect(evilAlice)
        .buyCollateral(
          evilWETH.address,
          exp(.5, 18),
          exp(3000, 6),
          evilAlice.address
        );
      await evilComet.accrueAccount(evilAlice.address);

      // !important; reenable automine
      await ethers.provider.send('evm_mine', [start + 1000]);
      await ethers.provider.send('evm_setAutomine', [true]);

      const normalTotalsBasic = await normalComet.totalsBasic();
      const normalTotalsCollateral = await normalComet.totalsCollateral(normalWETH.address);
      const evilTotalsBasic = await evilComet.totalsBasic();
      const evilTotalsCollateral = await evilComet.totalsCollateral(evilWETH.address);

      expect(normalTotalsBasic.baseSupplyIndex).to.equal(evilTotalsBasic.baseSupplyIndex);
      expect(normalTotalsBasic.baseBorrowIndex).to.equal(evilTotalsBasic.baseBorrowIndex);
      expect(normalTotalsBasic.trackingSupplyIndex).to.equal(evilTotalsBasic.trackingSupplyIndex);
      expect(normalTotalsBasic.trackingBorrowIndex).to.equal(evilTotalsBasic.trackingBorrowIndex);
      expect(normalTotalsBasic.totalSupplyBase).to.equal(evilTotalsBasic.totalSupplyBase);
      expect(normalTotalsBasic.totalBorrowBase).to.equal(evilTotalsBasic.totalBorrowBase);

      expect(normalTotalsCollateral.totalSupplyAsset).to.eq(evilTotalsCollateral.totalSupplyAsset);

      const normalAlicePortfolio = await portfolio(normalProtocol, normalAlice.address);
      const evilAlicePortfolio = await portfolio(evilProtocol, evilAlice.address);

      expect(normalAlicePortfolio.internal.USDC).to.deep.equal(evilAlicePortfolio.internal.EVIL);
      expect(normalAlicePortfolio.internal.WETH).to.deep.equal(evilAlicePortfolio.internal.WETH);

      const normalBobPortfolio = await portfolio(normalProtocol, normalBob.address);
      const evilBobPortfolio = await portfolio(evilProtocol, evilBob.address);

      expect(normalBobPortfolio.internal.USDC).to.equal(evilBobPortfolio.internal.EVIL);
    });
  });
});
