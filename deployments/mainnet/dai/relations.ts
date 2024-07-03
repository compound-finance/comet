import { RelationConfigMap } from '../../../plugins/deployment_manager/RelationConfig';
import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  'AppProxyUpgradeable': {
    artifact: 'contracts/ERC20.sol:ERC20',
  },
  'sUSDe': {
    artifact: 'contracts/ERC20.sol:ERC20',
  },
  'USDe': {
    artifact: 'contracts/ERC20.sol:ERC20',
  },
  'DAI': {
    artifact: 'contracts/ERC20.sol:ERC20',
  },
};
