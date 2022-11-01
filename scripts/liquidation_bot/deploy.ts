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
  const numAssets = await comet.numAssets();
  const assets = await Promise.all(Array(numAssets).fill(0).map((_, i) => comet.getAssetInfo(i)));

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
      assets.map(a => a.asset), // _assets
      assets.map(_a => false), // _lowLiquidityPools
      assets.map(_a => 500), // _poolFees
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