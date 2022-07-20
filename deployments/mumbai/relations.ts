import baseRelationConfig from '../relations';

export default {
  ...baseRelationConfig,
  'comet:implementation': {
    proxy: {
      field: (comet) => (comet.extensionDelegate ? comet.extensionDelegate() : null),
    },
    relations: {},
  },
  UChildERC20Proxy: {
    proxy: {
      field: {
        slot: '0xbaab7dbf64751104133af04abc7d9979f0fda3b059a322a8333f533d3f32bf7f',
      },
    },
    relations: {},
  },
};
