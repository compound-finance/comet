import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  'governor': {
    artifact: 'contracts/bridges/polygon/PolygonBridgeReceiver.sol:PolygonBridgeReceiver',
  }
};