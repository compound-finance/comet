import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact:
      'contracts/bridges/optimism/OptimismBridgeReceiver.sol:OptimismBridgeReceiver',
  },

  l2CrossDomainMessenger: {
    delegates: {
      field: {
        slot:
          '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      },
    },
  },

  l2StandardBridge: {
    delegates: {
      field: {
        slot:
          '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      },
    },
  },
  '0x1f32b1c2345538c0c6f582fcb022739c4a194ebb': {
    artifact: 'contracts/ERC20.sol:ERC20'
  },
};
