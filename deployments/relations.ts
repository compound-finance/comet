import { RelationConfigMap } from '../plugins/deployment_manager/RelationConfig';

let relationConfigMap: RelationConfigMap = {
  comet: {
    proxy: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      }
    },
    relations: {
      cometAdmin: {
        field: {
          slot: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
        }
      },
      baseToken: {
        alias: (token) => token.symbol(),
      },
      assets: {
        field: async (comet) => {
          let assetLen = await comet.numAssets();
          return await Promise.all([...new Array(assetLen)].map(async (el, i) => {
            let assetInfo = await comet.getAssetInfo(i);
            return assetInfo.asset;
          }));
        },
        alias: (token) => token.symbol(),
      },
    },
  },
  FiatTokenProxy: {
    proxy: {
      field: "implementation"
    },
    relations: {}
  }
};

export default relationConfigMap;
