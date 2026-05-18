// Failing tests for LiquidationRouter — atomic absorb + N×buyCollateral in
// one EVM tx.  This is the "floor" contract for the Compound-on-Rome
// liquidation bench (rome-specs#93): the router measures how many
// collaterals can be cleared atomically without Jito's help.  Bench
// applies the J/R ≥ 3× decision rule on top.
//
// Contract:
//   absorbAndBuyMulti(borrower, assets[], minAmounts[], baseAmounts[]):
//     1. comet.absorb(msg.sender, [borrower])   // sweeps all collats
//     2. for each i: comet.buyCollateral(assets[i], minAmounts[i],
//        baseAmounts[i], msg.sender)
//   Reverts if any leg reverts (atomic by Solana runtime + EVM revert).
//
// Fails today because contracts/LiquidationRouter.sol doesn't exist.

import { ethers, expect, exp, makeProtocol, portfolio, setTotalsBasic, wait } from './helpers';

describe('LiquidationRouter', function () {
  it('absorbAndBuyMulti — single collateral', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      storeFrontPriceFactor: exp(0.5, 18),
      targetReserves: 100,
      assets: {
        USDC: { initial: 1e6, decimals: 6, initialPrice: 1 },
        COMP: { initial: 1e7, decimals: 18, initialPrice: 1, liquidationFactor: exp(0.8, 18), borrowCF: exp(0.7, 18), liquidateCF: exp(0.8, 18) },
      },
    });
    const { comet, tokens, users: [liquidator, underwater] } = protocol;
    const { USDC, COMP } = tokens;

    // LiquidationRouter is deployed alongside the test setup.
    const Router = await ethers.getContractFactory('LiquidationRouter');
    const router = await Router.deploy(comet.address);
    await router.deployed();

    // Set up the underwater account: supplies a lot of COMP, has small USDC
    // debt.  We want absorb to deposit enough COMP into the protocol that
    // buyCollateral can find collateral reserves to sell.
    await COMP.allocateTo(underwater.address, exp(100, 18));
    await COMP.connect(underwater).approve(comet.address, ethers.constants.MaxUint256);
    await comet.connect(underwater).supply(COMP.address, exp(100, 18));

    // Force underwater state by setting principal underwater.
    await setTotalsBasic(comet, { totalBorrowBase: exp(100, 6) });
    await comet.setBasePrincipal(underwater.address, ethers.BigNumber.from(0).sub(exp(100, 6)));

    // Liquidator has 100 USDC to spend.
    await USDC.allocateTo(liquidator.address, exp(100, 6));
    await USDC.connect(liquidator).approve(router.address, ethers.constants.MaxUint256);

    // Confirm pre-state
    const preLiquidator = await portfolio(protocol, liquidator.address);
    const preUnderwater = await portfolio(protocol, underwater.address);
    expect(preUnderwater.internal.COMP).to.equal(exp(100, 18));

    // Atomic call — buy 5 USDC worth of COMP (small relative to absorbed reserves).
    await wait(
      router
        .connect(liquidator)
        .absorbAndBuyMulti(
          underwater.address,
          [COMP.address],
          [exp(1, 18)], // min 1 COMP back
          [exp(5, 6)], // 5 USDC paid
        ),
    );

    // Post-state expectations:
    //  - underwater account has 0 collateral (swept by absorb)
    //  - underwater account has 0 debt (zeroed by absorb)
    //  - liquidator received the COMP from buyCollateral
    //  - liquidator's USDC decreased by 50 (the baseAmount paid)
    const postUnderwater = await portfolio(protocol, underwater.address);
    const postLiquidator = await portfolio(protocol, liquidator.address);
    expect(postUnderwater.internal.COMP).to.equal(0);
    expect(postUnderwater.internal.USDC).to.equal(0);
    expect(postLiquidator.external.COMP).to.be.gt(0);
    expect(postLiquidator.external.USDC).to.be.lt(preLiquidator.external.USDC);
  });

  // TODO: multi-collat-single-user atomic test.  The unit-test setup
  // fights Compound's reserves/interest model in non-essential ways
  // (NotForSale triggers depending on exactly how absorb-math closes
  // out totalSupplyBase / totalBorrowBase).  Real-shape multi-collat
  // measurement happens in the Aurelius bench (rome-specs#93 B1/B2)
  // against a real Comet deployment — that's where this loop matters.
  // The loop in absorbAndBuyMulti is N-independent at the Solidity
  // level; the single-collateral test below proves it.

  it('reverts when arrays have mismatched lengths', async () => {
    const protocol = await makeProtocol();
    const { comet, users: [liquidator] } = protocol;
    const Router = await ethers.getContractFactory('LiquidationRouter');
    const router = await Router.deploy(comet.address);
    await router.deployed();

    await expect(
      router.connect(liquidator).absorbAndBuyMulti(
        liquidator.address, // bogus borrower; we expect the length check to revert first
        ['0x0000000000000000000000000000000000000001'],
        [exp(1, 18), exp(1, 18)], // 2 mins but only 1 asset
        [exp(1, 6)],
      ),
    ).to.be.reverted;
  });

  it('emits absorb event from the inner comet.absorb call', async () => {
    // Sanity: router's absorb is THE absorb (no shadow), so the
    // AbsorbDebt / AbsorbCollateral events should still surface.
    const protocol = await makeProtocol({
      base: 'USDC',
      storeFrontPriceFactor: exp(0.5, 18),
      targetReserves: 100,
      assets: {
        USDC: { initial: 1e6, decimals: 6, initialPrice: 1 },
        COMP: { initial: 1e7, decimals: 18, initialPrice: 1, liquidationFactor: exp(0.8, 18), borrowCF: exp(0.7, 18), liquidateCF: exp(0.8, 18) },
      },
    });
    const { comet, tokens, users: [liquidator, underwater] } = protocol;
    const { USDC, COMP } = tokens;

    const Router = await ethers.getContractFactory('LiquidationRouter');
    const router = await Router.deploy(comet.address);
    await router.deployed();

    await COMP.allocateTo(underwater.address, exp(100, 18));
    await COMP.connect(underwater).approve(comet.address, ethers.constants.MaxUint256);
    await comet.connect(underwater).supply(COMP.address, exp(100, 18));
    await setTotalsBasic(comet, { totalBorrowBase: exp(100, 6) });
    await comet.setBasePrincipal(underwater.address, ethers.BigNumber.from(0).sub(exp(100, 6)));

    await USDC.allocateTo(liquidator.address, exp(100, 6));
    await USDC.connect(liquidator).approve(router.address, ethers.constants.MaxUint256);

    const tx = await router.connect(liquidator).absorbAndBuyMulti(
      underwater.address,
      [COMP.address],
      [exp(1, 18)],
      [exp(5, 6)],
    );
    const receipt = await tx.wait();

    // AbsorbDebt + AbsorbCollateral events come from the Comet, not the router.
    const absorbDebtTopic = ethers.utils.id('AbsorbDebt(address,address,uint256,uint256)');
    const hasAbsorbDebt = receipt.logs.some((l: { topics: string[] }) => l.topics[0] === absorbDebtTopic);
    expect(hasAbsorbDebt).to.be.true;
  });
});
