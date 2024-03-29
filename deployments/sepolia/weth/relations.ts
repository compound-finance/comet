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
  baseL1CrossDomainMessenger: {
    artifact: 'contracts/bridges/optimism/IL1CrossDomainMessenger.sol:IL1CrossDomainMessenger',
    delegates: {
      // Not great, but this address shouldn't change and is very difficult to grab on-chain (private methods)
      field: async () => '0xC34855F4De64F1840e5686e64278da901e261f20'
    }
  },
};
