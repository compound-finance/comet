export default [
  {
    'inputs': [
      {
        'internalType': 'contract ISwapRouter',
        'name': '_swapRouter',
        'type': 'address'
      },
      {
        'internalType': 'contract CometInterface',
        'name': '_comet',
        'type': 'address'
      },
      {
        'internalType': 'address',
        'name': '_factory',
        'type': 'address'
      },
      {
        'internalType': 'address',
        'name': '_WETH9',
        'type': 'address'
      },
      {
        'internalType': 'address[]',
        'name': '_assets',
        'type': 'address[]'
      },
      {
        'internalType': 'uint24[]',
        'name': '_poolFees',
        'type': 'uint24[]'
      }
    ],
    'stateMutability': 'nonpayable',
    'type': 'constructor'
  },
  {
    'inputs': [],
    'name': 'WETH9',
    'outputs': [
      {
        'internalType': 'address',
        'name': '',
        'type': 'address'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'comet',
    'outputs': [
      {
        'internalType': 'contract CometInterface',
        'name': '',
        'type': 'address'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'defaultPoolFee',
    'outputs': [
      {
        'internalType': 'uint24',
        'name': '',
        'type': 'uint24'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'factory',
    'outputs': [
      {
        'internalType': 'address',
        'name': '',
        'type': 'address'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'components': [
          {
            'internalType': 'address[]',
            'name': 'accounts',
            'type': 'address[]'
          },
          {
            'internalType': 'address',
            'name': 'pairToken',
            'type': 'address'
          },
          {
            'internalType': 'uint24',
            'name': 'poolFee',
            'type': 'uint24'
          },
          {
            'internalType': 'bool',
            'name': 'reversedPair',
            'type': 'bool'
          }
        ],
        'internalType': 'struct Liquidator.FlashParams',
        'name': 'params',
        'type': 'tuple'
      }
    ],
    'name': 'initFlash',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'address',
        'name': '',
        'type': 'address'
      }
    ],
    'name': 'poolFees',
    'outputs': [
      {
        'internalType': 'uint24',
        'name': '',
        'type': 'uint24'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'refundETH',
    'outputs': [],
    'stateMutability': 'payable',
    'type': 'function'
  },
  {
    'inputs': [],
    'name': 'swapRouter',
    'outputs': [
      {
        'internalType': 'contract ISwapRouter',
        'name': '',
        'type': 'address'
      }
    ],
    'stateMutability': 'view',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'address',
        'name': 'token',
        'type': 'address'
      },
      {
        'internalType': 'uint256',
        'name': 'amountMinimum',
        'type': 'uint256'
      },
      {
        'internalType': 'address',
        'name': 'recipient',
        'type': 'address'
      }
    ],
    'name': 'sweepToken',
    'outputs': [],
    'stateMutability': 'payable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'uint256',
        'name': 'fee0',
        'type': 'uint256'
      },
      {
        'internalType': 'uint256',
        'name': 'fee1',
        'type': 'uint256'
      },
      {
        'internalType': 'bytes',
        'name': 'data',
        'type': 'bytes'
      }
    ],
    'name': 'uniswapV3FlashCallback',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  },
  {
    'inputs': [
      {
        'internalType': 'uint256',
        'name': 'amountMinimum',
        'type': 'uint256'
      },
      {
        'internalType': 'address',
        'name': 'recipient',
        'type': 'address'
      }
    ],
    'name': 'unwrapWETH9',
    'outputs': [],
    'stateMutability': 'payable',
    'type': 'function'
  },
  {
    'stateMutability': 'payable',
    'type': 'receive'
  }
];