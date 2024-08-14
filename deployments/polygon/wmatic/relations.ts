import { RelationConfigMap } from '../../../plugins/deployment_manager/RelationConfig';
import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  'governor': {
    artifact: 'contracts/bridges/polygon/PolygonBridgeReceiver.sol:PolygonBridgeReceiver',
  },
  InitializableImmutableAdminUpgradeabilityProxy: {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  UChildERC20Proxy: {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0xbaab7dbf64751104133af04abc7d9979f0fda3b059a322a8333f533d3f32bf7f',
      }
    },
  }
};