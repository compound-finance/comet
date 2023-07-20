import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact: 'contracts/bridges/arbitrum/ArbitrumBridgeReceiver.sol:ArbitrumBridgeReceiver'
  },
  ClonableBeaconProxy: {
    artifact: 'contracts/ERC20.sol:ERC20'
  },
  // USDC
  '0x8FB1E3fC51F3b789dED7557E680551d93Ea9d892': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  // WETH
  '0xe39ab88f8a4777030a534146a9ca3b52bd5d43a3': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  }
};
