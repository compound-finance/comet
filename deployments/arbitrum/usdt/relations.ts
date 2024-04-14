import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact: 'contracts/bridges/arbitrum/ArbitrumBridgeReceiver.sol:ArbitrumBridgeReceiver'
  },
  ClonableBeaconProxy: {
    artifact: 'contracts/ERC20.sol:ERC20'
  },
  // USDT
  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9': {
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
  // GMX
  '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a': {
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
  },
  // WBTC
  '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  // wstETH
  '0x5979D7b546E38E414F7E9822514be443A4800529': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
};
