import { RelationConfigMap } from '../../../plugins/deployment_manager/RelationConfig';
import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  fxRoot: {
    relations: {
      stateSender: {
        field: async (fxRoot) => fxRoot.stateSender()
      }
    }
  },
  arbitrumInbox: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      },
    },
    relations: {
      arbitrumBridge: {
        field: async (inbox) => inbox.bridge()
      }
    }
  },
  arbitrumL1GatewayRouter: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      }
    },
  },
  baseL1CrossDomainMessenger: {
    delegates: {
      // Not great, but this address shouldn't change and is very difficult to grab on-chain (private methods)
      field: async () => '0x81C4Bd600793EBd1C0323604E1F455fE50A951F8',
    },
  },
  baseL1StandardBridge: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  opL1CrossDomainMessenger: {
    delegates: {
      field: async () => '0x2150Bc3c64cbfDDbaC9815EF615D6AB8671bfe43'
    }
  },
  opL1StandardBridge: {
    delegates: {
      field: {
        slot:
          '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
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
  scrollL1USDCGateway: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  }
};
