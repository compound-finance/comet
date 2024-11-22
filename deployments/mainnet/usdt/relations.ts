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
  },
  'ERC1967Proxy': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
};