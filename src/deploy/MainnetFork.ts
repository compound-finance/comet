import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  Comet__factory,
  Comet,
  CometExt__factory,
  CometExt,
  CometFactory__factory,
  CometFactory,
  CometRewards,
  CometRewards__factory,
  GovernorSimple,
  GovernorSimple__factory,
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
import { shouldDeploy } from '../utils';
import { wait, exp } from '../../test/helpers';

// mainnet assets
const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const COMP = '0xc00e94cb662c3520282e6f5717214004a7f26888';
const LINK = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
const UNI = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// Chainlink mainnet price feeds
const USDC_USD_PRICE_FEED = '0x8fffffd4afb6115b954bd326cbe7b4ba576818f6';
const ETH_USDC_PRICE_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';
const WBTC_USDC_PRICE_FEED = '0xf4030086522a5beea4988f8ca5b36dbc97bee88c';
const COMP_USDC_PRICE_FEED = '0xdbd020caef83efd542f4de03e3cf0c28a4428bd5';
const LINK_USDC_PRICE_FEED = '0x2c1d072e956affc0d435cb7ac38ef18d24d9127c';
const UNI_USDC_PRICE_FEED = '0x553303d460ee0afb37edff9be42922d8ff63220e';

// TODO: Support configurable assets as well?
export async function deployMainnetForkComet(
  deploymentManager: DeploymentManager,
  contractsToDeploy: ContractsToDeploy = { all: true },
  configurationOverrides: ProtocolConfiguration = {},
): Promise<DeployedContracts> {
  const [admin, pauseGuardianSigner] = await deploymentManager.getSigners();

  let ethConfig = {
    asset: WETH,
    priceFeed: ETH_USDC_PRICE_FEED,
    decimals: (18).toString(),
    borrowCollateralFactor: (0.82e18).toString(),
    liquidateCollateralFactor: (0.85e18).toString(),
    liquidationFactor: (0.93e18).toString(),
    supplyCap: (100e18).toString(),
  };
  let compConfig = {
    asset: COMP,
    priceFeed: COMP_USDC_PRICE_FEED,
    decimals: (18).toString(),
    borrowCollateralFactor: (0.65e18).toString(),
    liquidateCollateralFactor: (0.7e18).toString(),
    liquidationFactor: (0.92e18).toString(),
    supplyCap: exp(500000, 18),
  };
  let wbtcConfig = {
    asset: WBTC,
    priceFeed: WBTC_USDC_PRICE_FEED,
    decimals: (8).toString(),
    borrowCollateralFactor: (0.7e18).toString(),
    liquidateCollateralFactor: (0.75e18).toString(),
    liquidationFactor: (0.93e18).toString(),
    supplyCap: exp(35000, 8),
  };
  let linkConfig = {
    asset: LINK,
    priceFeed: LINK_USDC_PRICE_FEED,
    decimals: (18).toString(),
    borrowCollateralFactor: (0.75e18).toString(),
    liquidateCollateralFactor: (0.8e18).toString(),
    liquidationFactor: (0.92e18).toString(),
    supplyCap: exp(50000000, 18),
  };
  let uniConfig = {
    asset: UNI,
    priceFeed: UNI_USDC_PRICE_FEED,
    decimals: (18).toString(),
    borrowCollateralFactor: (0.75e18).toString(),
    liquidateCollateralFactor: (0.8e18).toString(),
    liquidationFactor: (0.92e18).toString(),
    supplyCap: exp(50000000, 18),
  };

  let governorSimple, timelock, proxyAdmin, cometExt, cometProxy, configuratorProxy, comet, configurator, cometFactory, rewards;

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
    await wait(governorSimple.initialize(timelock.address, [admin.address]));
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
      baseToken: USDC,
      baseTokenPriceFeed: USDC_USD_PRICE_FEED,
      supplyKink: (0.8e18).toString(),
      supplyPerYearInterestRateBase: (0).toString(),
      supplyPerYearInterestRateSlopeLow: (0.0325e18).toString(),
      supplyPerYearInterestRateSlopeHigh: (0.4e18).toString(),
      borrowKink: (0.8e18).toString(),
      borrowPerYearInterestRateBase: (0.015e18).toString(),
      borrowPerYearInterestRateSlopeLow: (0.035e18).toString(),
      borrowPerYearInterestRateSlopeHigh: (0.25e18).toString(),
      storeFrontPriceFactor: (0.5e18).toString(),
      trackingIndexScale: (1e15).toString(), // XXX add 'exp' to scen framework?
      baseTrackingSupplySpeed: (0.00001157e15).toString(), // XXX
      baseTrackingBorrowSpeed: (0.0011458333e15).toString(), // XXX
      baseMinForRewards: (1000000e6).toString(), // XXX
      baseBorrowMin: (1000e6).toString(),
      targetReserves: (5000000e6).toString(), // XXX
      assetConfigs: [wbtcConfig, ethConfig, uniConfig, compConfig, linkConfig],
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

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.rewards)) {
    rewards = await deploymentManager.deploy<CometRewards, CometRewards__factory, [string]>(
      'CometRewards.sol',
      [timelock.address]
    );
  } else {
    rewards = await deploymentManager.contract('rewards') as CometRewards;
  }

  /* === Proxies === */

  if (shouldDeploy(contractsToDeploy.all, contractsToDeploy.cometProxyAdmin)) {
    let proxyAdminArgs: [] = [];
    proxyAdmin = await deploymentManager.deploy<CometProxyAdmin, CometProxyAdmin__factory, []>(
      'CometProxyAdmin.sol',
      proxyAdminArgs
    );
    await wait(proxyAdmin.transferOwnership(governor));
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
      (await configurator.populateTransaction.initialize(admin.address)).data,
    ]);

    // Set the initial factory and configuration for Comet in Configurator
    const configuratorAsProxy = (configurator as Configurator).attach(configuratorProxy.address).connect(admin);
    await wait(configuratorAsProxy.setFactory(cometProxy.address, cometFactory.address));
    await wait(configuratorAsProxy.setConfiguration(cometProxy.address, configuration));

    // Transfer ownership of Configurator
    await wait(configuratorAsProxy.transferGovernor(governor));

    updatedRoots.set('configurator', configuratorProxy.address);
  } else {
    configuratorProxy = await deploymentManager.contract('configurator') as Configurator;
  }

  await deploymentManager.putRoots(updatedRoots);
  await deploymentManager.spider();

  return {
    comet,
    cometProxy,
    configuratorProxy,
    timelock,
    governor: governorSimple,
    rewards,
  };
}
