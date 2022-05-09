import { absorbLiquidatableBorrowers } from "../index";
import { expect, exp, makeProtocol } from '../../../test/helpers';

describe('Absorption Bot#absorbLiquidatableBorrowers', () => {
  it('absorbs all liquidatable borrowers', async () => {
    const { comet, tokens, priceFeeds, users: [absorber, underwaterBorrower] } = await makeProtocol({
      base: 'USDC',
      assets: {
        USDC: { decimals: 6 },
        COMP: { decimals: 18, initialPrice: 1 },
      },
    });
    const { USDC, COMP } = tokens;

    await USDC.allocateTo(comet.address, exp(1000, 6));
    await COMP.allocateTo(underwaterBorrower.address, exp(100, 18));
    await COMP.connect(underwaterBorrower).approve(comet.address, exp(100, 18));

    // user supplies and takes out loan
    await comet.connect(underwaterBorrower).supply(COMP.address, exp(100, 18));
    await comet.connect(underwaterBorrower).withdraw(USDC.address, exp(80, 6));

    // position becomes liquidatable
    await priceFeeds['COMP'].setPrice(exp(5,7));

    await absorbLiquidatableBorrowers(comet, absorber);

    // position has been absorbed
    expect(await comet.getLiquidationMargin(underwaterBorrower.address)).to.eq(0);
    expect(await comet.isLiquidatable(underwaterBorrower.address)).to.be.false;

    // absorber receives liquidator points
    expect((await comet.liquidatorPoints(absorber.address)).numAbsorbs).to.eq(1);
    expect((await comet.liquidatorPoints(absorber.address)).numAbsorbed).to.eq(1);
  });
});