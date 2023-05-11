import hre from 'hardhat';
import { ethers } from 'ethers';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { OnChainLiquidator } from '../../build/types';

interface LiquidationAddresses {
  balancerVault: string;
  uniswapRouter: string;
  uniswapV3Factory: string;
  sushiswapRouter: string;
  stakedNativeToken: string;
  weth9: string;
  wrappedStakedNativeToken: string;
}

const sharedAddresses = {
  balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  uniswapRouter: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984'
};

const addresses: {[network: string]: LiquidationAddresses} = {
  mainnet: {
    ...sharedAddresses,
    sushiswapRouter: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    stakedNativeToken: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    weth9: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    wrappedStakedNativeToken: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'

  },
  polygon: {
    ...sharedAddresses,
    sushiswapRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    stakedNativeToken: '0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4',
    weth9: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
    wrappedStakedNativeToken: ethers.constants.AddressZero // wstMatic does not exist
  },
  arbitrum: {
    ...sharedAddresses,
    sushiswapRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    stakedNativeToken: ethers.constants.AddressZero,
    weth9: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    wrappedStakedNativeToken: ethers.constants.AddressZero
  }
};

async function main() {
  const network = hre.network.name;
  const deployment = 'abc'; // doesn't matter; just need a value to instantiate DeploymentManager

  if (!['mainnet', 'polygon', 'arbitrum'].includes(network)) {
    throw new Error(`unable to deploy Liquidator to network: ${network}`);
  }

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

  const {
    balancerVault,
    uniswapRouter,
    uniswapV3Factory,
    sushiswapRouter,
    stakedNativeToken,
    weth9,
    wrappedStakedNativeToken
  } = addresses[network];

  const liquidator = await dm.deploy(
    'liquidator',
    'liquidator/OnChainLiquidator.sol',
    [
      balancerVault,
      sushiswapRouter,
      uniswapRouter,
      uniswapV3Factory,
      stakedNativeToken,
      wrappedStakedNativeToken,
      weth9
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