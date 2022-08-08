import { RelationConfigMap } from '../plugins/deployment_manager/RelationConfig';

const relationConfigMap: RelationConfigMap = {
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
        field: async (_, { baseToken }) => baseToken[0].address
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
  FiatTokenProxy: {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
      },
    },
  },
};

export default relationConfigMap;
