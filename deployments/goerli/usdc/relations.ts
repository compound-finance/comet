import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  'fxRoot': {
    relations: {
      stateSender: {
        field: async (fxRoot) => fxRoot.stateSender()
      }
    }
  }
};