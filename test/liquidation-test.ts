import { expect, exp, makeProtocol, portfolio, wait, calculatePortfolioValue, setTotalsBasic } from './helpers';

// End-to-end liquidation tests
describe.only('liquidation', function () {
  it('protocol loses reserves when storeFrontPriceFactor below liquidationFactor', async () => {
    // Assume liquidationFactor=0.95 and storeFrontPriceFactor=0.9.
    // Malicious actor A knows COMP price is going to drop in the pricefeed soon, so they do the following sandwich attack:
    // 1. COMP price is 1. A uses 100 COMP to borrow max (80 USDC given borrowCF=0.8, liquidateCF=0.85)
    // 2. COMP price drops to 0.9. Position is now undercollateralized.
    // 3. A calls absorb. Liquidation penalty of 5%. A's borrow balance gets paid back by Comet, resulting in
    //    a positive -80+.95*90=5.5 USDC balance for A. Comet receives 100 COMP (worth $90) and pays A $85.5 USDC.
    //    This equates to a $4.5 profit.
    // 4. User buys 100 COMP from protocol for 10% off ($90*0.9=$81, a $9 haircut from market price).
    // 5. Protocol ends up with 4.5-9=$-4.5 profit after all of this, meaning it lost reserves.
    const params = {
      interestRateBase: 0,
      interestRateSlopeLow: 0,
      interestRateSlopeHigh: 0,
      storeFrontPriceFactor: exp(0.9, 18), // 10% storefront discount > 5% liquidation penalty
      targetReserves: exp(1, 28), // absurdly high target reserves
      assets: {
        USDC: { decimals: 6 },
        COMP: { initial: 1e7,
                decimals: 18,
                initialPrice: 1, // 1 COMP = 1 USDC
                borrowCF: exp(0.8, 18),
                liquidateCF: exp(0.85, 18),
                liquidationFactor: exp(0.95, 18), // 5% liquidation penalty
              },
      },
    };
    const protocol = await makeProtocol(params);
    const {
      comet,
      tokens,
      priceFeeds,
      users: [attacker],
    } = protocol;
    const { USDC, COMP } = tokens;
    const compPricefeed = priceFeeds['COMP'];

    // 1. Attacker borrows max (80 USDC) from Comet
    await setTotalsBasic(comet, { totalBorrowBase: exp(80, 6) });
    await USDC.allocateTo(attacker.address, 100e6); // 80 of this is borrowed from Comet
    await COMP.allocateTo(comet.address, exp(100, 18));
    await comet.setBasePrincipal(attacker.address, exp(-80, 6));
    await comet.setCollateralBalance(attacker.address, COMP.address, exp(100, 18));
    await comet.setTotalsCollateral(COMP.address, { totalSupplyAsset: exp(100, 18), _reserved: 0 });

    const portfolioA0 = await portfolio(protocol, attacker.address);
    const portfolioValueA0 = await calculatePortfolioValue(protocol, portfolioA0);

    expect(await comet.isLiquidatable(attacker.address)).to.be.false;

    const reserves0 = await comet.getReserves();

    // 2. COMP price drops to 0.9. Attacker's account is now liquidatable.
    await compPricefeed.setPrice(exp(0.9, 8));

    expect(await comet.isLiquidatable(attacker.address)).to.be.true;

    // 3. Attacker calls absorb on their own account.
    const a0 = await wait(comet.absorb(attacker.address, [attacker.address]));

    // 4. Attacker buys 100 COMP (worth $90) for 0.9 * $90 = $81 from Comet.
    const usdcPriceOfCollateral = exp(81e6);
    await wait(USDC.connect(attacker).approve(comet.address, usdcPriceOfCollateral));
    await wait(comet.connect(attacker).buyCollateral(COMP.address, exp(100, 18), usdcPriceOfCollateral, attacker.address)); // XXX using exactly 100e18 as min will fail due to precision

    // 5. Protocol ends up with loss.
    const reserves1 = await comet.getReserves();
    const portfolioA1 = await portfolio(protocol, attacker.address);
    const portfolioValueA1 = await calculatePortfolioValue(protocol, portfolioA1);

    // Protocol loses 4.5 USDC
    expect(reserves1.sub(reserves0)).to.be.equal(exp(-4.5, 6));
    // Atacker loses -$10 due to COMP price drop but made $4.5 from sandwich attack
    expect(portfolioValueA1 - portfolioValueA0).to.be.equal(exp(-5.5, 8));
  });
});
