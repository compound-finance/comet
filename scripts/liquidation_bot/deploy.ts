import hre from 'hardhat';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { OnChainLiquidator } from '../../build/types';

const BALANCER_VAULT = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
const SUSHISWAP_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';
const UNISWAP_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

const ST_ETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const WST_ETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';

async function main() {
  const network = hre.network.name;
  const deployment = 'abc'; // doesn't matter; just need a value to instantiate DeploymentManager

  const dm = new DeploymentManager(
    network,
    deployment,
    hre,
    {
      writeCacheToDisk: false,
      verificationStrategy: 'eager'
    }
  );
  await dm.spider();

  const liquidator = await dm.deploy(
    'liquidator',
    'liquidator/OnChainLiquidator.sol',
    [
      BALANCER_VAULT,
      SUSHISWAP_ROUTER,
      UNISWAP_ROUTER,
      UNISWAP_V3_FACTORY,
      ST_ETH,
      WST_ETH,
      WETH9
    ]
  ) as OnChainLiquidator;

  console.log(`Liquidator deployed on ${network} @ ${liquidator.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });