import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact: 'contracts/bridges/optimism/OptimismBridgeReceiver.sol:OptimismBridgeReceiver'
  },

  l2CrossDomainMessenger: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },

  // Canonical L2 WBTC is not verified on Etherscan
  '0xe0a592353e81a94db6e3226fd4a99f881751776a': {
    artifact: 'contracts/ERC20.sol:ERC20'
  }
};