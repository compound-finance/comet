import { RelationConfigMap } from '../plugins/deployment_manager/RelationConfig';

const relationConfigMap: RelationConfigMap = {
  comptrollerV2: {
    delegates: {
      field: async (comptroller) => comptroller.comptrollerImplementation(),
    },
  },

  comet: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      },
    },
    relations: {
      baseToken: {
        alias: async (token) => token.symbol(),
      },
      baseTokenPriceFeed: {
        field: async (comet) => comet.baseTokenPriceFeed(),
        alias: async (_, { baseToken }) => `${await baseToken[0].symbol()}:priceFeed`,
      },
      assets: {
        field: async (comet) => {
          const n = await comet.numAssets();
          return Promise.all(
            Array(n).fill(0).map(async (_, i) => {
              const assetInfo = await comet.getAssetInfo(i);
              return assetInfo.asset;
            })
          );
        },
        alias: async (token) => token.symbol(),
      },
      assetPriceFeeds: {
        field: async (comet) => {
          const n = await comet.numAssets();
          return Promise.all(
            Array(n).fill(0).map(async (_, i) => {
              const assetInfo = await comet.getAssetInfo(i);
              return assetInfo.priceFeed;
            })
          );
        },
        alias: async (_, { assets }, i) => `${await assets[i].symbol()}:priceFeed`,
      },
      cometAdmin: {
        field: {
          slot: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
        },
      },
    },
  },
  'comet:implementation': {
    artifact: 'contracts/Comet.sol:Comet',
    delegates: {
      field: async (comet) => comet.extensionDelegate(),
    },
  },
  configurator: {
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      }
    },
    relations: {
      configuratorAdmin: {
        field: {
          slot: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
        }
      },
      cometFactory: {
        field: async (configurator, { comet }) => configurator.factory(comet[0].address),
      }
    }
  },
  cometAdmin: {
    relations: {
      timelock: {
        field: async (cometAdmin) => cometAdmin.owner()
      }
    }
  },
  timelock: {
    relations: {
      governor: {
        field: async (timelock) => timelock.admin(),
      }
    }
  },

  governor: {
    artifact: 'contracts/IProxy.sol:IProxy',
    delegates: {
      field: async (governor) => governor.implementation(),
    },
    relations: {
      COMP: {
        field: async (governor) => governor.comp(),
      }
    }
  },
  'governor:implementation': {
    artifact: 'contracts/IGovernorBravo.sol:IGovernorBravo',
  },

  COMP: {
    artifact: 'contracts/IComp.sol:IComp',
  },

  FiatTokenProxy: {
    artifact: 'contracts/ERC20.sol:ERC20',
    relations: {
      fiatTokenAdmin: {
        field: {
          slot: '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b',
        },
        alias: async (_admin, _ctx, _i, [token]) => `${await token.symbol()}:admin`,
      }
    },
    delegates: {
      field: {
        slot: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
      },
    },
  },

  rewards: {
    relations: {
      rewardToken: {
        field: async (rewards, { comet }) => {
          const rewardToken = (await rewards.rewardConfig(comet[0].address)).token;
          return rewardToken !== '0x0000000000000000000000000000000000000000' ? rewardToken : null;
        },
        alias: async (token) => token.symbol(),
      },
    },
  },
};

export default relationConfigMap;
