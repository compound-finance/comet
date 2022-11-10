import hre from 'hardhat';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { CometInterface } from '../../build/types';
import { requireEnv } from '../../hardhat.config';

// https://docs.uniswap.org/protocol/reference/deployments
const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const SWAP_ROUTER = '0xe592427a0aece92de3edee1f18e0157c05861564';

async function main() {
  const DEPLOYMENT = requireEnv('DEPLOYMENT');
  const RECIPIENT = requireEnv('RECIPIENT');
  const network = hre.network.name;
  if (['hardhat', 'fuji'].includes(network)) {
    throw new Error(`Uniswap unavailable on network: ${network}`);
  }

  const dm = new DeploymentManager(
    network,
    DEPLOYMENT,
    hre,
    {
      writeCacheToDisk: true,
      verificationStrategy: 'eager'
    }
  );
  await dm.spider();

  const comet = await dm.contract('comet') as CometInterface;

  const liquidator = await dm.deploy(
    'liquidator',
    'liquidator/Liquidator.sol',
    [
      RECIPIENT, // _recipient
      SWAP_ROUTER, // _swapRouter
      comet.address, // _comet
      UNISWAP_V3_FACTORY_ADDRESS, // _factory
      WETH9, // _WETH9
      0, // _liquidationThreshold,
      [
        '0xc00e94Cb662C3520282E6f5717214004A7f26888', // COMP
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
        '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
      ],
      [
        true,
        true,
        false,
        true,
        true
      ],
      [
        3000,
        3000,
        500,
        3000,
        3000
      ]
    ]
  );

  console.log(`Liquidator deployed on ${network} @ ${liquidator.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });