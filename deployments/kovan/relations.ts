import { RelationConfigMap } from '../../plugins/deployment_manager/RelationConfig';
import baseRelationConfig from '../relations';

const relationConfig = {
  ...baseRelationConfig,
  'comet:implementation': {
    proxy: {
      field: (comet) => (comet.extensionDelegate ? comet.extensionDelegate() : null),
    },
    relations: {},
  },
};

// override timelock.admin() call since the Timelock on Kovan doesn't have an admin yet
delete relationConfig['timelock']

export default relationConfig;