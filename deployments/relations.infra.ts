import baseRelationConfig from './relations';

export default {
  ...baseRelationConfig,
  // Override governor to use UUPS storage slot
  governor: {
    artifact: 'contracts/IProxy.sol:IProxy',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', // UUPS implementation slot
      }
    },
    relations: {
      COMP: {
        field: async (governor) => {
          return governor.comp();
        },
      }
    }
  },
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
          const rewardConfig = await rewards.rewardConfig(comet[0].address);
          return !rewardConfig ? null : rewardConfig.token;
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