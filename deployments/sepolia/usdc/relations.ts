import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  // USDC / USD price feed
  '0xa2f78ab2355fe2f984d808b5cee7fd0a93d5270e': {
    artifact: 'contracts/IPriceFeed.sol:IPriceFeed'
  },
  // WBTC / USD price feed
  '0x1b44f3514812d835eb1bdb0acb33d3fa3351ee43': {
    artifact: 'contracts/IPriceFeed.sol:IPriceFeed'
  },
  // WETH / USD price feed
  '0x694aa1769357215de4fac081bf1f309adc325306': {
    artifact: 'contracts/IPriceFeed.sol:IPriceFeed'
  },
  fxRoot: {
    relations: {
      stateSender: {
        field: async fxRoot => fxRoot.stateSender()
      }
    }
  },
  arbitrumInbox: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    },
    relations: {
      arbitrumBridge: {
        field: async inbox => inbox.bridge()
      }
    }
  },
  arbitrumL1GatewayRouter: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  baseL1CrossDomainMessenger: {
    delegates: {
      // Not great, but this address shouldn't change and is very difficult to grab on-chain (private methods)
      field: async () => '0xa042e16781484716c1Ef448c919af7BCd9607467'
    }
  },
  baseL1StandardBridge: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  lineaMessageService: {
    artifact: 'contracts/bridges/linea/IMessageService.sol:IMessageService',
    // delegates: {
    //   field: {
    //     slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
    //   }
    // }
  },
  lineaL1TokenBridge: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  lineaL1usdcBridge: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },  
  unichainSepoliaL1CrossDomainMessenger: {
    delegates: {
      field: async () => '0x61e0DA8FEC03C5e3252D742e78534CE24B82634e'
    }
  },
  unichainSepoliaL1StandardBridge: {
    delegates: {
      field: {
        slot:
          '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
};
