import { RelationConfigMap } from '../../../plugins/deployment_manager/RelationConfig';
import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  'wstETH': {
    artifact: 'contracts/bulkers/IWstETH.sol',
    relations: {
      stETH: {
        field: async (wstETH) => wstETH.stETH()
      }
    }
  },
  'USDT': {
    artifact: 'contracts/test/NonStandardFaucetFeeToken.sol:NonStandardFeeToken',
  },
  'TetherToken': {
    artifact: 'contracts/test/NonStandardFaucetFeeToken.sol:NonStandardFeeToken',
  },
  'AppProxyUpgradeable': {
    artifact: 'contracts/ERC20.sol:ERC20',
  }
};