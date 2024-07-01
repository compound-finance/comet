import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  'governor': {
    artifact: 'contracts/bridges/polygon/PolygonBridgeReceiver.sol:PolygonBridgeReceiver',
  },
  TransparentUpgradeableProxy: {
    artifact: 'contracts/ERC20.sol:ERC20'
  },
  OssifiableProxy: {
    artifact: 'contracts/ERC20.sol:ERC20'
  },
  ClonableBeaconProxy: {
    artifact: 'contracts/ERC20.sol:ERC20'
  },
  // WETH
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  // rETH
  '0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  // wstETH
  '0x5979D7b546E38E414F7E9822514be443A4800529': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  },
  // weETH
  '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe': {
    artifact: 'contracts/ERC20.sol:ERC20',
    delegates: {
      field: {
        slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
      }
    }
  }
};