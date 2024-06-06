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
    artifact: 'contracts/test/NonStandardFaucetToken.sol:NonStandardToken',
  },
  'TetherToken': {
    artifact: 'contracts/test/NonStandardFaucetToken.sol:NonStandardToken',
  },
  'AppProxyUpgradeable': {
    artifact: 'contracts/ERC20.sol:ERC20',
  }
};