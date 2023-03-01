import { RelationConfigMap } from '../../../plugins/deployment_manager/RelationConfig';
import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  'governor': {
    artifact: 'contracts/bridges/arbitrum/ArbitrumBridgeReceiver.sol:ArbitrumBridgeReceiver',
  },
  ClonableBeaconProxy: {
    artifact: 'contracts/ERC20.sol:ERC20',
  },
  TransparentUpgradeableProxy: {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      }
    },
  },
};