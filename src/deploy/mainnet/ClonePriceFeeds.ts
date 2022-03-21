import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { AggregatorV3Interface, SimplePriceFeed, SimplePriceFeed__factory } from '../../../build/types';
import { ethers } from "hardhat";
import { debug } from 'console';

// source: https://docs.chain.link/docs/ethereum-addresses/
const priceFeedAddresses = {
  // usdc: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', // USDC/USD
  // wbtc: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', // BTC/USD
  // weth: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // ETH/USD
  // comp: '0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5', // COMP/USD
  // uni: '0x553303d460EE0afB37EdFf9bE42922D8FF63220e', // UNI/USD
  // link: '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c', // LINK/USD
  wbtc: {
    aggregatorProxy: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    aggregator: '0xae74faa92cb67a95ebcab07358bc222e33a34da7',
    initialPrice: 41000
  }
};

export async function clonePriceFeed(
  name: string,
  deploymentManager: DeploymentManager,
): Promise<AggregatorV3Interface> {

  console.log(`cloning price feed for: ${name}`);

  // XXX replace with ChainLink pricefeed clone
  const {initialPrice} = priceFeedAddresses[name.toLowerCase()];

  if (!initialPrice) {
    throw new Error(`Do not know how to clone mainnet price feed for: ${name}`);
  }

  return await deploymentManager.deploy<
    SimplePriceFeed,
    SimplePriceFeed__factory,
    [number, number]
  >('test/SimplePriceFeed.sol', [initialPrice * 1e8, 8]);
}