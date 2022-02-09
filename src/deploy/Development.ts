import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  CometExt__factory,
  CometExt,
  CometInterface,
  CometFactory__factory,
  CometFactory,
  FaucetToken__factory,
  FaucetToken,
  CometProxyAdmin,
  CometProxyAdmin__factory,
  SimplePriceFeed,
  SimplePriceFeed__factory,
  TransparentUpgradeableFactoryProxy__factory,
  TransparentUpgradeableFactoryProxy,
} from '../../build/types';
import { ConfigurationStruct } from '../../build/types/Comet';
import { ExtConfigurationStruct } from '../../build/types/CometExt';
import { BigNumberish } from 'ethers';
export { Comet } from '../../build/types';
import { DeployedContracts, ProtocolConfiguration } from './index';

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
    [string, string, number, string]
  >('test/FaucetToken.sol', [
    (BigInt(amount) * 10n ** BigInt(decimals)).toString(),
    name,
    decimals,
    symbol,
  ]);
}

async function makePriceFeed(
  deploymentManager: DeploymentManager,
  initialPrice: number,
  decimals: number
): Promise<SimplePriceFeed> {
  return await deploymentManager.deploy<
    SimplePriceFeed,
    SimplePriceFeed__factory,
    [number, number]
  >('test/SimplePriceFeed.sol', [initialPrice * 1e8, decimals]);
}

// TODO: Support configurable assets as well?
export async function deployDevelopmentComet(
  deploymentManager: DeploymentManager,
  deployProxy: boolean = true,
  configurationOverrides: ProtocolConfiguration = {}
): Promise<DeployedContracts> {
  const signers = await deploymentManager.hre.ethers.getSigners();

  let dai = await makeToken(deploymentManager, 1000000, 'DAI', 18, 'DAI');
  let gold = await makeToken(deploymentManager, 2000000, 'GOLD', 8, 'GOLD');
  let silver = await makeToken(deploymentManager, 3000000, 'SILVER', 10, 'SILVER');

  let daiPriceFeed = await makePriceFeed(deploymentManager, 1, 8);
  let goldPriceFeed = await makePriceFeed(deploymentManager, 0.5, 8);
  let silverPriceFeed = await makePriceFeed(deploymentManager, 0.05, 8);

  let assetConfig0 = {
    asset: gold.address,
    priceFeed: goldPriceFeed.address,
    decimals: (8).toString(),
    borrowCollateralFactor: (0.9e18).toString(),
    liquidateCollateralFactor: (1e18).toString(),
    liquidationFactor: (0.95e18).toString(),
    supplyCap: (1000000e8).toString(),
  };

  let assetConfig1 = {
    asset: silver.address,
    priceFeed: silverPriceFeed.address,
    decimals: (10).toString(),
    borrowCollateralFactor: (0.4e18).toString(),
    liquidateCollateralFactor: (0.5e18).toString(),
    liquidationFactor: (0.9e18).toString(),
    supplyCap: (500000e10).toString(),
  };

  const {
    symbol,
    governor,
    pauseGuardian,
    baseToken,
    baseTokenPriceFeed,
    kink,
    perYearInterestRateSlopeLow,
    perYearInterestRateSlopeHigh,
    perYearInterestRateBase,
    reserveRate,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    targetReserves,
    assetConfigs,
  } = {
    ...{
      symbol: '📈BASE',
      governor: await signers[0].getAddress(),
      pauseGuardian: await signers[1].getAddress(),
      baseToken: dai.address,
      baseTokenPriceFeed: daiPriceFeed.address,
      kink: (8e17).toString(), // 0.8
      perYearInterestRateBase: (5e15).toString(), // 0.005
      perYearInterestRateSlopeLow: (1e17).toString(), // 0.1
      perYearInterestRateSlopeHigh: (3e18).toString(), // 3.0
      reserveRate: (1e17).toString(), // 0.1
      trackingIndexScale: (1e15).toString(), // XXX add 'exp' to scen framework?
      baseTrackingSupplySpeed: 0, // XXX
      baseTrackingBorrowSpeed: 0, // XXX
      baseMinForRewards: 1, // XXX
      baseBorrowMin: 1, // XXX
      targetReserves: 0, // XXX
      assetConfigs: [assetConfig0, assetConfig1],
    },
    ...configurationOverrides,
  };

  const extConfiguration = {
    symbol32: deploymentManager.hre.ethers.utils.formatBytes32String(symbol),
  };
  const cometExt = await deploymentManager.deploy<CometExt, CometExt__factory, [ExtConfigurationStruct]>(
    'CometExt.sol',
    [extConfiguration]
  );

  const configuration = {
    governor,
    pauseGuardian,
    baseToken,
    baseTokenPriceFeed,
    extensionDelegate: cometExt.address,
    kink,
    perYearInterestRateSlopeLow,
    perYearInterestRateSlopeHigh,
    perYearInterestRateBase,
    reserveRate,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    targetReserves,
    assetConfigs,
  };
  const comet = await deploymentManager.deploy<Comet, Comet__factory, [ConfigurationStruct]>(
    'Comet.sol',
    [configuration]
  );

  let proxy = null;
  if (deployProxy) {
    const cometFactory = await deploymentManager.deploy<CometFactory, CometFactory__factory, []>(
      'CometFactory.sol',
      []
    );

    let proxyAdminArgs: [] = [];
    let proxyAdmin = await deploymentManager.deploy<CometProxyAdmin, CometProxyAdmin__factory, []>(
      'CometProxyAdmin.sol',
      proxyAdminArgs
    );
    
    proxy = await deploymentManager.deploy<
      TransparentUpgradeableFactoryProxy,
      TransparentUpgradeableFactoryProxy__factory,
      [string, string, string, string]
    >('TransparentUpgradeableFactoryProxy.sol', [
      cometFactory.address,
      comet.address,
      proxyAdmin.address,
      (await comet.populateTransaction.initializeStorage()).data,
    ]);

    await proxyAdmin.connect(governor).setConfiguration(proxy.address, configuration);

    await deploymentManager.putRoots(new Map([['comet', proxy.address]]));
  }

  return {
    comet: await deploymentManager.hre.ethers.getContractAt('CometInterface', comet.address) as CometInterface,
    proxy,
    tokens: [dai, gold, silver],
  };
}
