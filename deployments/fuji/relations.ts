import { RelationConfigMap } from '../../plugins/deployment_manager/RelationConfig';
import baseRelationConfig from '../relations';

export default {
  ...baseRelationConfig,
  'comet:implementation': {
    relations: {},
  },
};
