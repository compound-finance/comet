import { RelationConfigMap } from '../../../plugins/deployment_manager/RelationConfig';
import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  'AppProxyUpgradeable': {
    artifact: 'contracts/ERC20.sol:ERC20',
  }
};