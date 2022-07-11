import { expect, exp } from '../helpers';
import liquidateUnderwaterBorrowers from '../../scripts/liquidation_bot/liquidateUnderwaterBorrowers';
import makeLiquidatableProtocol, { forkMainnet, resetHardhatNetwork } from './makeLiquidatableProtocol';

describe('Liquidation Bot', function () {
  before(forkMainnet);
  after(resetHardhatNetwork);

  describe('liquidateUnderwaterBorrowers', function () {
    it('liquidates underwater borrowers', async function () {
      const {
        comet,
        liquidator,
        users: [signer, underwater],
        assets: { dai, usdc  },
        whales: { usdcWhale }
      } = await makeLiquidatableProtocol();

      // transfer USDC to comet, so it has money to pay out withdraw to underwater user
      await usdc.connect(usdcWhale).transfer(comet.address, 300000000n); // 300e6
      await dai.connect(underwater).approve(comet.address, 120000000000000000000n);
      await comet.connect(underwater).supply(dai.address, 120000000000000000000n);
      // withdraw to ensure that there is a Withdraw event for the user
      await comet.connect(underwater).withdraw(usdc.address, 10e6);
      // put the position underwater
      await comet.setBasePrincipal(underwater.address, -(exp(200, 6)));

      expect(await comet.isLiquidatable(underwater.address)).to.be.true;

      await liquidateUnderwaterBorrowers(
        comet,
        liquidator,
        signer
      );

      expect(await comet.isLiquidatable(underwater.address)).to.be.false;
    });
  });
});