import { scenario } from './context/CometContext';
import { LiquidatorV2 } from '../build/types';
import { attemptLiquidation } from '../scripts/liquidation_bot/liquidateUnderwaterBorrowers';

const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

scenario.only(
  'LiquidationBotV2 > XXX TEST',
  {},
  async ({ comet, actors }, _context, world) => {
    const { charles } = actors;

    const liquidator = await world.deploymentManager.deploy(
      'liquidator',
      'liquidator/LiquidatorV2.sol',
      [
        comet.address,
        UNISWAP_V3_FACTORY_ADDRESS, // _factory
        WETH9, // _WETH9
      ]
    ) as LiquidatorV2;

    await attemptLiquidation(
      comet,
      liquidator,
      [],
      {
        signer: charles.signer
      },
      'mainnet'
    );
  }
)