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
}; 