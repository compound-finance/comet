import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact: 'contracts/bridges/scroll/ScrollBridgeReceiver.sol:ScrollBridgeReceiver'
  },
  l2Messenger: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  l2ERC20Gateway: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  l2ETHGateway: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  l2WETHGateway: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  '0x477df03cb8c83ec241df01302a9d13102676eee4': {
    artifact: 'contracts/Configurator.sol:Configurator',
  },
  '0x3effaacd82fa5a76d539b7d9cee0250f972f115f': {
    artifact: 'contracts/CometFactory.sol:CometFactory',
  }
};
