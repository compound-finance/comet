import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact:
      'contracts/bridges/optimism/OptimismBridgeReceiver.sol:OptimismBridgeReceiver',
  },

  OssifiableProxy: {
    artifact: 'contracts/ERC20.sol:ERC20'
  },

  TransparentUpgradeableProxy: {
    artifact: 'contracts/ERC20.sol:ERC20'
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

  // wstETH
  '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },

  // rETH
  '0x9Bcef72be871e61ED4fBbc7630889beE758eb81D': {
    artifact: 'contracts/ERC20.sol:ERC20'
  },
};
