import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact: 'contracts/bridges/linea/LineaBridgeReceiver.sol:LineaBridgeReceiver'
  },
  // COMP
  '0xab3134fa5edfb3dc64aa790e8bb6448117d18fe9': {
    artifact: 'contracts/ERC20.sol:ERC20',
  },
  // WBTC
  '0xDbcd5BafBAA8c1B326f14EC0c8B125DB57A5cC4c': {
    artifact: 'contracts/ERC20.sol:ERC20',
  },
  l2MessageService: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  l2TokenBridge: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  l2usdcBridge: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  }
};
