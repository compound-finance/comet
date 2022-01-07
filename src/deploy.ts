import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager, Roots } from '../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  FaucetToken__factory,
  FaucetToken,
  MockedOracle,
  MockedOracle__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableProxy,
} from '../build/types';
import { ConfigurationStruct } from '../build/types/Comet';
export { Comet } from '../build/types';

async function makeToken(
  deploymentManager: DeploymentManager,
  amount: number,
  name: string,
  decimals: number,
  symbol: string
): Promise<FaucetToken> {
  return await deploymentManager.deploy<
    FaucetToken,
    FaucetToken__factory,
    [number, string, number, string]
  >('asteroid/FaucetToken.sol', [amount, name, decimals, symbol]);
}

interface DeployedContracts {
  comet: Comet;
  oracle: MockedOracle;
  proxy: TransparentUpgradeableProxy;
}

export async function deployComet(
  deploymentManager: DeploymentManager
): Promise<DeployedContracts> {
  const [governor, pauseGuardian] = await deploymentManager.hre.ethers.getSigners();

  let baseToken = await makeToken(deploymentManager, 100000, 'DAI', 18, 'DAI');
  let asset0 = await makeToken(deploymentManager, 200000, 'GOLD', 8, 'GOLD');
  let asset1 = await makeToken(deploymentManager, 300000, 'SILVER', 10, 'SILVER');

  const oracle = await deploymentManager.deploy<MockedOracle, MockedOracle__factory, []>(
    'asteroid/MockedOracle.sol',
    [],
    governor
  );

  let assetInfo0 = {
    asset: asset0.address,
    borrowCollateralFactor: (1e18).toString(),
    liquidateCollateralFactor: (1e18).toString(),
  };

  let assetInfo1 = {
    asset: asset1.address,
    borrowCollateralFactor: (0.5e18).toString(),
    liquidateCollateralFactor: (0.5e18).toString(),
  };

  const comet = await deploymentManager.deploy<Comet, Comet__factory, [ConfigurationStruct]>(
    'Comet.sol',
    [
      {
        governor: await governor.getAddress(),
        pauseGuardian: await pauseGuardian.getAddress(),
        priceOracle: oracle.address,
        baseToken: baseToken.address,
        assetInfo: [assetInfo0, assetInfo1],
      },
    ]
  );

  let proxyAdminArgs: [] = [];
  const proxyAdmin = await deploymentManager.deploy<ProxyAdmin, ProxyAdmin__factory, []>(
    'asteroid/vendor/proxy/ProxyAdmin.sol',
    proxyAdminArgs
  );

  const proxy = await deploymentManager.deploy<
    TransparentUpgradeableProxy,
    TransparentUpgradeableProxy__factory,
    [string, string, []]
  >('asteroid/vendor/proxy/TransparentUpgradeableProxy.sol', [
    comet.address,
    proxyAdmin.address,
    [],
  ]);

  await deploymentManager.setRoots({ TransparentUpgradeableProxy: proxy.address } as Roots);

  return {
    comet,
    oracle,
    proxy,
  };
}
