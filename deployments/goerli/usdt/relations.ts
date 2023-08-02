import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  'fxRoot': {
    relations: {
      stateSender: {
        field: async (fxRoot) => fxRoot.stateSender()
      }
    }
  },
  'AppProxyUpgradeable': {
    artifact: 'contracts/ERC20.sol:ERC20',
  }
};
