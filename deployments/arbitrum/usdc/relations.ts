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
  '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  // ARB
  '0x912ce59144191c1204e64559fe8253a0e49e6548': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  // WETH
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  }
};
