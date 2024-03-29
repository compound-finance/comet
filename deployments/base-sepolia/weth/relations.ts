import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact: 'contracts/bridges/optimism/OptimismBridgeReceiver.sol:OptimismBridgeReceiver'
  },

  // cbETH
  '0x774ed9edb0c5202df9a86183804b5d9e99dc6ca3': {
    artifact: 'contracts/ERC20.sol:ERC20',
  },

  // WETH
  '0x4200000000000000000000000000000000000006': {
    artifact: 'contracts/ERC20.sol:ERC20',
  },

  // COMP
  '0x2f535da74048c0874400f0371fba20df983a56e2': {
    artifact: 'contracts/ERC20.sol:ERC20',
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
  }
};