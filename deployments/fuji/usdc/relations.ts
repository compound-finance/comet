import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: {
    artifact: 'contracts/bridges/succinct/SuccinctBridgeReceiver.sol:SuccinctBridgeReceiver'
  },
};
