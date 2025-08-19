import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  // Override rewards relation to handle infrastructure deployment (no comet yet)
  rewards: {
    relations: {
      rewardToken: {
        field: async (rewards, context) => {
          // If no comet exists yet (infrastructure deployment), return null
          const comet = context.comet;
          if (!comet || comet.length === 0) {
            return null;
          }
          const rewardToken = (await rewards.rewardConfig(comet[0].address)).token;
          return rewardToken !== '0x0000000000000000000000000000000000000000' ? rewardToken : null;
        },
        alias: async (token) => token.symbol(),
      },
    },
  },
  // Fix cometAdmin relation with missing alias field
  cometAdmin: {
    relations: {
      timelock: {
        field: async (cometAdmin) => cometAdmin.owner(),
        alias: 'timelock'
      }
    }
  },
  // Fix configurator relations with missing alias fields
  configurator: {
    ...baseRelationConfig.configurator,
    relations: {
      ...baseRelationConfig.configurator.relations,
      cometFactory: {
        field: async (configurator, { comet }) => {
          // Only try to get factory if comet exists
          if (!comet || comet.length === 0) {
            return null;
          }
          return configurator.factory(comet[0].address);
        },
        alias: 'cometFactory'
      }
    }
  },
}; 