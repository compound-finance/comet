import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact:
      'contracts/bridges/ronin/RoninBridgeReceiver.sol:RoninBridgeReceiver',
  },

  l2SonicBridge: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },

  l2CCIPOffRamp: {
  },

  ERC1967Proxy: {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },

  TransparentUpgradeableProxy: {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
};
