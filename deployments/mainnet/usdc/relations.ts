import { RelationConfigMap } from '../../../plugins/deployment_manager/RelationConfig';
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