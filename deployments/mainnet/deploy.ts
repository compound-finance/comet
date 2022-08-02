import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { deployNetworkComet } from '../../src/deploy/Network';
import { Contract } from 'ethers';
import { debug } from '../../plugins/deployment_manager/Utils';
import { Bulker, Bulker__factory } from '../../build/types';

interface Vars {
  comet: string,
  configurator: string,
  rewards: string,
  bulker: string
};

export default async function deploy(deploymentManager: DeploymentManager) {
  const newRoots = await deployContracts(deploymentManager);
  deploymentManager.putRoots(new Map(Object.entries(newRoots)));

  debug("Roots.json have been set to:");
  debug("");
  debug("");
  debug(JSON.stringify(newRoots, null, 4));
  debug("");

  // We have to re-spider to get the new deployments
  await deploymentManager.spider();

  return newRoots;
}

async function deployContracts(deploymentManager: DeploymentManager): Promise<Vars> {
  // Contracts referenced in `configuration.json`.
  // XXX use an address intead of a Contract
  let contracts = new Map<string, Contract>([
    ['USDC', await getErc20ContractAt(deploymentManager, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')],
    ['WBTC', await getErc20ContractAt(deploymentManager, '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599')],
    ['WETH', await getErc20ContractAt(deploymentManager, '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')],
    ['COMP', await getErc20ContractAt(deploymentManager, '0xc00e94cb662c3520282e6f5717214004a7f26888')],
    ['UNI', await getErc20ContractAt(deploymentManager, '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984')],
    ['LINK', await getErc20ContractAt(deploymentManager, '0x514910771af9ca656af840dff83e8264ecf986ca')],
  ]);

  // Deploy all Comet-related contracts
  let { cometProxy, configuratorProxy, timelock, rewards } = await deployNetworkComet(
    deploymentManager,
    { all: true },
    { governor: '0x6d903f6003cca6255d85cca4d3b5e5146dc33925' },
    contracts
  );

  // Deploy Bulker
  const bulker = await deploymentManager.deploy<Bulker, Bulker__factory, [string, string, string]>(
    'Bulker.sol',
    [timelock.address, cometProxy.address, contracts.get('WETH').address]
  );

  return {
    comet: cometProxy.address,
    configurator: configuratorProxy.address,
    rewards: rewards.address,
    bulker: bulker.address
  };
}

async function getErc20ContractAt(deploymentManager: DeploymentManager, address: string): Promise<Contract> {
  return deploymentManager.hre.ethers.getContractAt(
    'ERC20',
    address,
    await deploymentManager.getSigner()
  );
}