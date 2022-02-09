import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { BigNumberish } from 'ethers';

import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  FaucetToken__factory,
  FaucetToken,
  ProxyAdmin,
  ProxyAdmin__factory,
  ERC20,
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableProxy,
} from '../../build/types';
import { AssetInfoStruct, ConfigurationStruct } from '../../build/types/Comet';

import { DeployedContracts, CometConfigurationOverrides } from './index';
import { getConfiguration } from './NetworkConfiguration';

export async function deployNetworkComet(
  deploymentManager: DeploymentManager,
  deployProxy: boolean = true,
  configurationOverrides: CometConfigurationOverrides = {},
  contractMapOverride?: ContractMap,
): Promise<DeployedContracts> {
  const [governor, pauseGuardian] = await deploymentManager.hre.ethers.getSigners();

  let networkConfiguration = await getConfiguration(deploymentManager.deployment, deploymentManager.hre, contractMapOverride);
  let configuration = {
    ...networkConfiguration,
    ...configurationOverrides,
  };

  const comet = await deploymentManager.deploy<Comet, Comet__factory, [ConfigurationStruct]>(
    'Comet.sol',
    [configuration]
  );

  let proxy = null;
  if (deployProxy) {
    let proxyAdminArgs: [] = [];
    let proxyAdmin = await deploymentManager.deploy<ProxyAdmin, ProxyAdmin__factory, []>(
      'vendor/proxy/ProxyAdmin.sol',
      proxyAdminArgs
    );

    proxy = await deploymentManager.deploy<
      TransparentUpgradeableProxy,
      TransparentUpgradeableProxy__factory,
      [string, string, string]
    >('vendor/proxy/TransparentUpgradeableProxy.sol', [
      comet.address,
      proxyAdmin.address,
      (await comet.populateTransaction.XXX_REMOVEME_XXX_initialize()).data,
    ]);
  }

  return {
    comet,
    proxy,
  };
}
