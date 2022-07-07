import { expect  } from '../helpers';
import liquidateUnderwaterBorrowers from '../../scripts/liquidation_bot/liquidateUnderwaterBorrowers';
import makeLiquidatableProtocol, { forkMainnet, resetHardhatNetwork } from './makeLiquidatableProtocol';

describe('Liquidation Bot', function () {
  before(forkMainnet);
  after(resetHardhatNetwork);

  describe('liquidateUnderwaterBorrowers', function () {
    it('liquidates underwater borrowers', async function () {
      const { comet, liquidator, users: [signer, underwater] } = await makeLiquidatableProtocol();
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