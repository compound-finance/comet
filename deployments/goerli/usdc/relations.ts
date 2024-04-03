import { RelationConfigMap } from '../../../plugins/deployment_manager/RelationConfig';
import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
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
    },
  },
  opL1CrossDomainMessenger: {
    delegates: {
      field: async () => '0xDa2332D0a7608919Cd331B1304Cd179129a90495',
    },
  },
  opL1StandardBridge: {
    delegates: {
      field: {
        slot:
          '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      },
    },
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
  scrollMessenger: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  scrollL1TokenBridge: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  }
};
