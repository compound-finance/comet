import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  // Reference infrastructure contracts from _infrastructure deployment
  timelock: {
    artifact: 'contracts/test/SimpleTimelock.sol:SimpleTimelock',
    network: 'local',
    deployment: '_infrastructure'
  },
  governor: {
    artifact: 'contracts/IProxy.sol:IProxy',
    network: 'local',
    deployment: '_infrastructure'
  },
  COMP: {
    artifact: 'contracts/IComp.sol:IComp',
    network: 'local',
    deployment: '_infrastructure'
  },
  fauceteer: {
    artifact: 'contracts/test/Fauceteer.sol:Fauceteer',
    network: 'local',
    deployment: '_infrastructure'
  },
  // Shared Admin & Governance contracts
  cometAdmin: {
    artifact: 'contracts/CometProxyAdmin.sol:CometProxyAdmin',
    network: 'local',
    deployment: '_infrastructure'
  },
  configurator: {
    artifact: 'contracts/Configurator.sol:Configurator',
    network: 'local',
    deployment: '_infrastructure'
  },
  'configurator:implementation': {
    artifact: 'contracts/Configurator.sol:Configurator',
    network: 'local',
    deployment: '_infrastructure'
  },
  configuratorProxy: {
    artifact: 'contracts/ConfiguratorProxy.sol:ConfiguratorProxy',
    network: 'local',
    deployment: '_infrastructure'
  },
  cometFactory: {
    artifact: 'contracts/CometFactory.sol:CometFactory',
    network: 'local',
    deployment: '_infrastructure'
  },
  // Reference tokens and price feeds from infrastructure
  DAI: {
    artifact: 'contracts/test/FaucetToken.sol:FaucetToken',
    network: 'local',
    deployment: '_infrastructure'
  },
  WETH: {
    artifact: 'contracts/test/FaucetToken.sol:FaucetToken',
    network: 'local',
    deployment: '_infrastructure'
  },
  WBTC: {
    artifact: 'contracts/test/FaucetToken.sol:FaucetToken',
    network: 'local',
    deployment: '_infrastructure'
  },
  'daiPriceFeed': {
    artifact: 'contracts/test/SimplePriceFeed.sol:SimplePriceFeed',
    network: 'local',
    deployment: '_infrastructure'
  },
  'wethPriceFeed': {
    artifact: 'contracts/test/SimplePriceFeed.sol:SimplePriceFeed',
    network: 'local',
    deployment: '_infrastructure'
  },
  'wbtcPriceFeed': {
    artifact: 'contracts/test/SimplePriceFeed.sol:SimplePriceFeed',
    network: 'local',
    deployment: '_infrastructure'
  },
  'compPriceFeed': {
    artifact: 'contracts/test/SimplePriceFeed.sol:SimplePriceFeed',
    network: 'local',
    deployment: '_infrastructure'
  }
}; 