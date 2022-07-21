import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  CometExt__factory,
  CometExt,
  CometFactory__factory,
  CometFactory,
  FaucetToken__factory,
  FaucetToken,
  GovernorSimple,
  GovernorSimple__factory,
  SimplePriceFeed,
  SimplePriceFeed__factory,
  SimpleTimelock,
  SimpleTimelock__factory,
  TransparentUpgradeableProxy,
  TransparentUpgradeableProxy__factory,
  Configurator,
  Configurator__factory,
  CometProxyAdmin,
  CometProxyAdmin__factory,
  ConfiguratorProxy,
  ConfiguratorProxy__factory,
  ProxyAdmin,
  CometInterface,
} from '../../build/types';
import { ConfigurationStruct } from '../../build/types/Comet';
import { ExtConfigurationStruct } from '../../build/types/CometExt';
export { Comet } from '../../build/types';
import { DeployedContracts, ContractsToDeploy, ProtocolConfiguration } from './index';
import { extractCalldata, fastGovernanceExecute, shouldDeploy } from '../utils';

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
  contractsToDeploy: ContractsToDeploy = { all: true },
  configurationOverrides: ProtocolConfiguration = {},
): Promise<DeployedContracts> {
  const [admin, pauseGuardianSigner] = await deploymentManager.getSigners();

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

  let governorSimple, timelock, proxyAdmin, cometExt, cometProxy, configuratorProxy, comet, configurator, cometFactory;

  /* === Deploy Contracts === */

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.governor)) {
    governorSimple = await deploymentManager.deploy<GovernorSimple, GovernorSimple__factory, []>(
      'test/GovernorSimple.sol',
      []
    );
  } else {
    governorSimple = await deploymentManager.contract('governor') as GovernorSimple;
  }

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.timelock)) {
    timelock = await deploymentManager.deploy<SimpleTimelock, SimpleTimelock__factory, [string]>(
      'test/SimpleTimelock.sol',
      [governorSimple.address]
    );
  } else {
    timelock = await deploymentManager.contract('timelock') as SimpleTimelock;
  }

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.governor)) {
    // Initialize the storage of GovernorSimple
    await governorSimple.initialize(timelock.address, [admin.address]);
  }

  const {
    symbol,
    governor,
    pauseGuardian,
    baseToken,
    baseTokenPriceFeed,
    supplyKink,
    supplyPerYearInterestRateSlopeLow,
    supplyPerYearInterestRateSlopeHigh,
    supplyPerYearInterestRateBase,
    borrowKink,
    borrowPerYearInterestRateSlopeLow,
    borrowPerYearInterestRateSlopeHigh,
    borrowPerYearInterestRateBase,
    storeFrontPriceFactor,
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
      governor: timelock.address,
      pauseGuardian: pauseGuardianSigner.address,
      baseToken: dai.address,
      baseTokenPriceFeed: daiPriceFeed.address,
      supplyKink: (0.8e18).toString(),
      supplyPerYearInterestRateBase: (0.0e18).toString(),
      supplyPerYearInterestRateSlopeLow: (0.05e18).toString(),
      supplyPerYearInterestRateSlopeHigh: (2e18).toString(),
      borrowKink: (0.8e18).toString(),
      borrowPerYearInterestRateBase: (0.005e18).toString(),
      borrowPerYearInterestRateSlopeLow: (0.1e18).toString(),
      borrowPerYearInterestRateSlopeHigh: (3e18).toString(),
      storeFrontPriceFactor: (0.95e18).toString(),
      trackingIndexScale: (1e15).toString(), // XXX add 'exp' to scen framework?
      baseTrackingSupplySpeed: 0, // XXX
      baseTrackingBorrowSpeed: 0, // XXX
      baseMinForRewards: 1, // XXX
      baseBorrowMin: (1e18).toString(),
      targetReserves: 0, // XXX
      assetConfigs: [assetConfig0, assetConfig1],
    },
    ...configurationOverrides,
  };

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.cometExt)) {
    const extConfiguration = {
      symbol32: deploymentManager.hre.ethers.utils.formatBytes32String(symbol),
    };
    cometExt = await deploymentManager.deploy<CometExt, CometExt__factory, [ExtConfigurationStruct]>(
      'CometExt.sol',
      [extConfiguration]
    );
  } else {
    cometExt = await deploymentManager.contract('comet:implementation:implementation') as CometExt;
  }

  const configuration = {
    governor,
    pauseGuardian,
    baseToken,
    baseTokenPriceFeed,
    extensionDelegate: cometExt.address,
    supplyKink,
    supplyPerYearInterestRateSlopeLow,
    supplyPerYearInterestRateSlopeHigh,
    supplyPerYearInterestRateBase,
    borrowKink,
    borrowPerYearInterestRateSlopeLow,
    borrowPerYearInterestRateSlopeHigh,
    borrowPerYearInterestRateBase,
    storeFrontPriceFactor,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    targetReserves,
    assetConfigs,
  };

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.comet)) {
    comet = await deploymentManager.deploy<Comet, Comet__factory, [ConfigurationStruct]>(
      'Comet.sol',
      [configuration]
    );
  } else {
    comet = await deploymentManager.contract('comet:implementation') as CometInterface;
  }

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.cometFactory)) {
    cometFactory = await deploymentManager.deploy<CometFactory, CometFactory__factory, []>(
      'CometFactory.sol',
      []
    );
  } else {
    // XXX need to handle the fact that there can be multiple Comet factories
  }

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.configurator)) {
    configurator = await deploymentManager.deploy<Configurator, Configurator__factory, []>(
      'Configurator.sol',
      []
    );
  } else {
    configurator = await deploymentManager.contract('configurator:implementation') as Configurator;
  }

  /* === Proxies === */

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.cometProxyAdmin)) {
    let proxyAdminArgs: [] = [];
    proxyAdmin = await deploymentManager.deploy<CometProxyAdmin, CometProxyAdmin__factory, []>(
      'CometProxyAdmin.sol',
      proxyAdminArgs
    );
    await proxyAdmin.transferOwnership(governor);
  } else {
    proxyAdmin = await deploymentManager.contract('cometAdmin') as ProxyAdmin;
  }

  let updatedRoots = await deploymentManager.getRoots();
  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.cometProxy)) {
    // Comet proxy
    cometProxy = await deploymentManager.deploy<
      TransparentUpgradeableProxy,
      TransparentUpgradeableProxy__factory,
      [string, string, string]
    >('vendor/proxy/transparent/TransparentUpgradeableProxy.sol', [
      comet.address,
      proxyAdmin.address,
      (await comet.populateTransaction.initializeStorage()).data,
    ]);

    updatedRoots.set('comet', cometProxy.address);
  } else {
    // Use the existing Comet proxy if a new one is not deployed
    // XXX This, along with Spider aliases, may need to be redesigned to support multiple Comet deployments
    cometProxy = await deploymentManager.contract('comet') as CometInterface;
  }

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.configuratorProxy)) {
    // Configuration proxy
    configuratorProxy = await deploymentManager.deploy<
      ConfiguratorProxy,
      ConfiguratorProxy__factory,
      [string, string, string]
    >('ConfiguratorProxy.sol', [
      configurator.address,
      proxyAdmin.address,
      (await configurator.populateTransaction.initialize(governor)).data,
    ]);

    // Set the initial factory and configuration for Comet in Configurator
    const setFactoryCalldata = extractCalldata((await configurator.populateTransaction.setFactory(cometProxy.address, cometFactory.address)).data);
    const setConfigurationCalldata = extractCalldata((await configurator.populateTransaction.setConfiguration(cometProxy.address, configuration)).data);
    await fastGovernanceExecute(
      governorSimple.connect(admin),
      [configuratorProxy.address, configuratorProxy.address],
      [0, 0],
      [
        'setFactory(address,address)',
        'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
      ],
      [setFactoryCalldata, setConfigurationCalldata]
    );

    updatedRoots.set('configurator', configuratorProxy.address);
  } else {
    configuratorProxy = await deploymentManager.contract('configurator') as Configurator;
  }

  await deploymentManager.putRoots(updatedRoots);

  return {
    comet,
    cometProxy,
    configuratorProxy,
    timelock,
    governor: governorSimple,
    tokens: [dai, gold, silver],
  };
}
