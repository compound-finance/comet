import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact: 'contracts/bridges/optimism/OptimismBridgeReceiver.sol:OptimismBridgeReceiver'
  },

  Proxy: {
    artifact: 'contracts/ERC20.sol:ERC20'
  },

  l2CrossDomainMessenger: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },

  l2StandardBridge: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },

  // wstETH
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
};
