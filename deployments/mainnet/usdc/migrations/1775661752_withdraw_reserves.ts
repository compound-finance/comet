import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { utils, Contract, BigNumber } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';

const withdrawConfigV2 = {
  cWBTC2: {
    address: '0xccF4429DB6322D5C611ee964527D42E5d685DD6a',
    asset: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    amount: 139,
    decimals: 8,
  },
  cUSDC: {
    address: '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
    asset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    amount: 5_772_174,
    decimals: 6,
  },
  cETH: {
    address: '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5',
    asset: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    amount: 813,
    decimals: 18,
  },
  cUSDT: {
    address: '0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9',
    asset: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    amount: 1_233_614,
    decimals: 6,
  },
  cBAT: {
    address: '0x6C8c6b02E7b2BE14d4fA6022Dfd6d75921D90E4E',
    asset: '0x0d8775f648430679a709e98d2b0cb6250d2887ef',
    amount: 2_475_186,
    decimals: 18,
  },
  cUNI: {
    address: '0x35A18000230DA775CAc24873d00Ff85BccdeD550',
    asset: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    amount: 66_056,
    decimals: 18,
  },
  cTUSD: {
    address: '0x12392F67bdf24faE0AF363c24aC620a2f67DAd86',
    asset: '0x0000000000085d4780b73119b644ae5ecd22b376',
    amount: 168_050,
    decimals: 18,
  },
  cLINK: {
    address: '0xFAce851a4921ce59e912d19329929CE6da6EB0c7',
    asset: '0x514910771af9ca656af840dff83e8264ecf986ca',
    amount: 7_874,
    decimals: 18,
  },
  cAAVE: {
    address: '0xe65cdB6479BaC1e22340E4E755fAE7E509EcD06c',
    asset: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    amount: 265,
    decimals: 18,
  },
  cCOMP: {
    address: '0x70e36f6BF80a52b3B46b3aF8e106CC0ed743E8e4',
    asset: '0xc00e94cb662c3520282e6f5717214004a7f26888',
    amount: 664,
    decimals: 18,
  },
};

const withdrawConfigV3 = {
  mainnet: {
    cUSDCv3: {
      address: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
      amount: 5_983_604,
      decimals: 6,
    }
  },
  optimism: {
    cUSDCv3: {
      address: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB',
      assetL1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      assetL2: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      amount: 258_077,
      decimals: 6,
    },
    cUSDTv3: {
      address: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214',
      assetL1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      assetL2: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
      amount: 10_242,
      decimals: 6,
    },
  },
  base: {
    cUSDbCv3: {
      address: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
      assetL1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      assetL2: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
      amount: 120_512,
      decimals: 6,
    },
  },
  arbitrum: {
    cUSDCv3: {
      address: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
      assetL1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      assetL2: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      amount: 43_556,
      decimals: 6,
    },
    cUSDCev3: {
      address: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
      assetL1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      assetL2: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
      amount: 257_235,
      decimals: 6,
    },
    cWETHv3: {
      address: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486',
      assetL1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      assetL2: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      amount: 34.76,
      decimals: 18,
    },
  }
};

const recipient = '0xDcB34b56842F853A69E86De5A0c22c49d97C130C';
const newVaultOwner = '0xefeD08b791423C7D7937507Cf840E86a7ddC11c1';

const OPTIMISM_BRIDGE_RECEIVER = '0xC3a73A70d1577CD5B02da0bA91C0Afc8fA434DAF';
const OPTIMISM_TIMELOCK = '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07';
const OPTIMISM_STANDARD_BRIDGE = '0x4200000000000000000000000000000000000010';

const BASE_BRIDGE_RECEIVER = '0x18281dfC4d00905DA1aaA6731414EABa843c468A';
const BASE_TIMELOCK = '0xCC3E7c85Bb0EE4f09380e041fee95a0caeDD4a02';
const BASE_STANDARD_BRIDGE = '0x4200000000000000000000000000000000000010';

const ARBITRUM_USDCE_GATEWAY = '0x096760F208390250649E3e8763348E783AEF5562';
const ARBITRUM_WETH_GATEWAY = '0x6c411aD3E74De3E7Bd422b94A27770f5B86C623B';
const ARBITRUM_BRIDGE_RECEIVER = '0x42480C37B249e33aABaf4c22B20235656bd38068';
const ARBITRUM_TIMELOCK = '0x3fB4d38ea7EC20D91917c09591490Eeda38Cf88A';
const ARBITRUM_CCTP_TOKEN_MESSENGER = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';

const AERA_VAULT = '0x8624f61Cc6e5A86790e173712AfDd480fa8b73Ba';
const AVANTGARDE_VAULT = '0xeB6332bbB14b1488eFb3A395B8EBF6a6904C4241';

let balancesBefore: Record<string, BigNumber> = {};

async function getErc20FromAddress(dm: DeploymentManager, address: string, ): Promise<Contract> {
  return new Contract(address, ['function balanceOf(address) view returns (uint256)'], await dm.getSigner());
}

export default migration('1775661752_withdraw_reserves', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const {
      timelock,
      governor,
      opL1CrossDomainMessenger,
      baseL1CrossDomainMessenger,
      arbitrumInbox
    } = await deploymentManager.getContracts();

    // Optimism
    const opHre = await forkedHreForBase({ name: 'optimism-usdc', network: 'optimism', deployment: 'usdc' });
    await deploymentManager.addBridgedDeploymentManager('optimism', 'usdc', opHre);
    const withdrawUsdcOptimismCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [OPTIMISM_TIMELOCK, exp(withdrawConfigV3.optimism.cUSDCv3.amount, withdrawConfigV3.optimism.cUSDCv3.decimals)]
    );

    const approveUsdcOptimismCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [OPTIMISM_STANDARD_BRIDGE, exp(withdrawConfigV3.optimism.cUSDCv3.amount, withdrawConfigV3.optimism.cUSDCv3.decimals)]
    );

    const bridgeERC20ToUsdcOptimismCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'address', 'uint256', 'uint32', 'bytes'],
      [
        withdrawConfigV3.optimism.cUSDCv3.assetL2, // _localToken
        withdrawConfigV3.optimism.cUSDCv3.assetL1, // _remoteToken
        recipient, // _to
        exp(withdrawConfigV3.optimism.cUSDCv3.amount, withdrawConfigV3.optimism.cUSDCv3.decimals), // _amount
        200000, // _minGasLimit
        '0x', // _data
      ]
    );

    const withdrawUsdtOptimismCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [OPTIMISM_TIMELOCK, exp(withdrawConfigV3.optimism.cUSDTv3.amount, withdrawConfigV3.optimism.cUSDTv3.decimals)]
    );

    const approveUsdtOptimismCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [OPTIMISM_STANDARD_BRIDGE, exp(withdrawConfigV3.optimism.cUSDTv3.amount, withdrawConfigV3.optimism.cUSDTv3.decimals)]
    );

    const bridgeERC20ToUsdtOptimismCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'address', 'uint256', 'uint32', 'bytes'],
      [
        withdrawConfigV3.optimism.cUSDTv3.assetL2, // _localToken
        withdrawConfigV3.optimism.cUSDTv3.assetL1, // _remoteToken
        recipient, // _to
        exp(withdrawConfigV3.optimism.cUSDTv3.amount, withdrawConfigV3.optimism.cUSDTv3.decimals), // _amount
        200000, // _minGasLimit
        '0x', // _data
      ]
    );

    const optimismProposalData1 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          withdrawConfigV3.optimism.cUSDTv3.address,
          withdrawConfigV3.optimism.cUSDTv3.assetL2,
          OPTIMISM_STANDARD_BRIDGE,
        ],
        [
          0, 0, 0,
        ],
        [
          'withdrawReserves(address,uint256)',
          'approve(address,uint256)',
          'bridgeERC20To(address,address,address,uint256,uint32,bytes)'
        ],
        [
          withdrawUsdtOptimismCalldata,
          approveUsdtOptimismCalldata,
          bridgeERC20ToUsdtOptimismCalldata,
        ]
      ]
    );

    const optimismProposalData2 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          withdrawConfigV3.optimism.cUSDCv3.address,
          withdrawConfigV3.optimism.cUSDCv3.assetL2,
          OPTIMISM_STANDARD_BRIDGE,
        ],
        [
          0, 0, 0,
        ],
        [
          'withdrawReserves(address,uint256)',
          'approve(address,uint256)',
          'bridgeERC20To(address,address,address,uint256,uint32,bytes)',
        ],
        [
          withdrawUsdcOptimismCalldata,
          approveUsdcOptimismCalldata,
          bridgeERC20ToUsdcOptimismCalldata,
        ]
      ]
    );
    // Base
    const baseHre = await forkedHreForBase({ name: 'base-usdbc', network: 'base', deployment: 'usdbc' });
    await deploymentManager.addBridgedDeploymentManager('base', 'usdbc', baseHre);
    const withdrawUsdbcBaseCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [BASE_TIMELOCK, exp(withdrawConfigV3.base.cUSDbCv3.amount, withdrawConfigV3.base.cUSDbCv3.decimals)]
    );

    const approveUsdbcBaseCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [BASE_STANDARD_BRIDGE, exp(withdrawConfigV3.base.cUSDbCv3.amount, withdrawConfigV3.base.cUSDbCv3.decimals)]
    );

    const bridgeERC20ToUsdbcBaseCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'address', 'uint256', 'uint32', 'bytes'],
      [
        withdrawConfigV3.base.cUSDbCv3.assetL2, // _localToken
        withdrawConfigV3.base.cUSDbCv3.assetL1, // _remoteToken
        recipient, // _to
        exp(withdrawConfigV3.base.cUSDbCv3.amount, withdrawConfigV3.base.cUSDbCv3.decimals), // _amount
        200000, // _minGasLimit
        '0x', // _data
      ]
    );

    const baseProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          withdrawConfigV3.base.cUSDbCv3.address,
          withdrawConfigV3.base.cUSDbCv3.assetL2,
          BASE_STANDARD_BRIDGE,
        ],
        [
          0, 0, 0,
        ],
        [
          'withdrawReserves(address,uint256)',
          'approve(address,uint256)',
          'bridgeERC20To(address,address,address,uint256,uint32,bytes)'
        ],
        [
          withdrawUsdbcBaseCalldata,
          approveUsdbcBaseCalldata,
          bridgeERC20ToUsdbcBaseCalldata,
        ]
      ]
    );

    // Arbitrum
    const arbitrumHre = await forkedHreForBase({ name: 'arbitrum-usdc', network: 'arbitrum', deployment: 'usdc' });
    const arbitrumDm = await deploymentManager.addBridgedDeploymentManager('arbitrum', 'usdc', arbitrumHre);
    const withdrawUsdcArbitrumCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [ARBITRUM_TIMELOCK, exp(withdrawConfigV3.arbitrum.cUSDCv3.amount, withdrawConfigV3.arbitrum.cUSDCv3.decimals)]
    );

    const withdrawUsdceArbitrumCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [ARBITRUM_TIMELOCK, exp(withdrawConfigV3.arbitrum.cUSDCev3.amount, withdrawConfigV3.arbitrum.cUSDCev3.decimals)]
    );

    const withdrawEthArbitrumCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [ARBITRUM_TIMELOCK, exp(withdrawConfigV3.arbitrum.cWETHv3.amount, withdrawConfigV3.arbitrum.cWETHv3.decimals)]
    );

    const approveUsdcArbitrumCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [ARBITRUM_CCTP_TOKEN_MESSENGER, exp(withdrawConfigV3.arbitrum.cUSDCv3.amount, withdrawConfigV3.arbitrum.cUSDCv3.decimals)]
    );

    const depositForBurnUsdcArbitrumCalldata = utils.defaultAbiCoder.encode(
      ['uint256', 'uint32', 'bytes32', 'address', 'bytes32', 'uint256', 'uint32'],
      [
        exp(withdrawConfigV3.arbitrum.cUSDCv3.amount, withdrawConfigV3.arbitrum.cUSDCv3.decimals), // amount
        0, // destinationDomain (Ethereum Mainnet)
        utils.hexZeroPad(recipient, 32), // mintRecipient
        withdrawConfigV3.arbitrum.cUSDCv3.assetL2, // burnToken
        utils.hexZeroPad('0x', 32), // destinationCaller
        exp(10, 6), // maxFee
        1000 // minFinalityThreshold
      ]
    );

    const approveUsdceArbitrumCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [ARBITRUM_USDCE_GATEWAY, exp(withdrawConfigV3.arbitrum.cUSDCev3.amount, withdrawConfigV3.arbitrum.cUSDCev3.decimals)]
    );

    const outboundTransferUsdceArbitrumCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256', 'bytes'],
      [
        withdrawConfigV3.arbitrum.cUSDCev3.assetL1, // l1Token
        recipient, // to
        exp(withdrawConfigV3.arbitrum.cUSDCev3.amount, withdrawConfigV3.arbitrum.cUSDCev3.decimals), // amount
        '0x' // data
      ]
    );

    const approveWethArbitrumCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [ARBITRUM_WETH_GATEWAY, exp(withdrawConfigV3.arbitrum.cWETHv3.amount, withdrawConfigV3.arbitrum.cWETHv3.decimals)]
    );

    const outboundTransferWethArbitrumCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256', 'bytes'],
      [
        withdrawConfigV3.arbitrum.cWETHv3.assetL1, // l1Token
        recipient, // to
        exp(withdrawConfigV3.arbitrum.cWETHv3.amount, withdrawConfigV3.arbitrum.cWETHv3.decimals), // amount
        '0x' // data
      ]
    );

    const arbitrumProposalData1 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          withdrawConfigV3.arbitrum.cUSDCv3.address,
          withdrawConfigV3.arbitrum.cUSDCv3.assetL2,
          ARBITRUM_CCTP_TOKEN_MESSENGER,
        ],
        [
          0, 0, 0,
        ],
        [
          'withdrawReserves(address,uint256)',
          'approve(address,uint256)',
          'depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
        ],
        [
          withdrawUsdcArbitrumCalldata,
          approveUsdcArbitrumCalldata,
          depositForBurnUsdcArbitrumCalldata,
        ]
      ]
    );

    const arbitrumProposalData2 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          withdrawConfigV3.arbitrum.cUSDCev3.address,
          withdrawConfigV3.arbitrum.cUSDCev3.assetL2,
          ARBITRUM_USDCE_GATEWAY,
        ],
        [
          0, 0, 0,
        ],
        [
          'withdrawReserves(address,uint256)',
          'approve(address,uint256)',
          'outboundTransfer(address,address,uint256,bytes)',
        ],
        [
          withdrawUsdceArbitrumCalldata,
          approveUsdceArbitrumCalldata,
          outboundTransferUsdceArbitrumCalldata,
        ]
      ]
    );

    const arbitrumProposalData3 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          withdrawConfigV3.arbitrum.cWETHv3.address,
          withdrawConfigV3.arbitrum.cWETHv3.assetL2,
          ARBITRUM_WETH_GATEWAY
        ],
        [
          0, 0, 0,
        ],
        [
          'withdrawReserves(address,uint256)',
          'approve(address,uint256)',
          'outboundTransfer(address,address,uint256,bytes)',
        ],
        [
          withdrawEthArbitrumCalldata,
          approveWethArbitrumCalldata,
          outboundTransferWethArbitrumCalldata
        ]
      ]
    );

    const createRetryableTicketGasParams1 = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: ARBITRUM_BRIDGE_RECEIVER,
        data: arbitrumProposalData1
      },
      arbitrumDm
    );

    const createRetryableTicketGasParams2 = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: ARBITRUM_BRIDGE_RECEIVER,
        data: arbitrumProposalData2
      },
      arbitrumDm
    );

    const createRetryableTicketGasParams3 = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: ARBITRUM_BRIDGE_RECEIVER,
        data: arbitrumProposalData3
      },
      arbitrumDm
    );

    const refundAddress = ARBITRUM_TIMELOCK;

    // Vaults
    const transferOwnershipCalldata = utils.defaultAbiCoder.encode(
      ['address'],
      [newVaultOwner]
    );

    const avantgardeVault = new Contract(
      AVANTGARDE_VAULT, [
        'function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) external',
        'function swapOwner(address,address,address) external'
      ],
      await deploymentManager.getSigner()
    );
    const swapOwnerCalldata = avantgardeVault.interface.encodeFunctionData(
      'swapOwner',
      // [address(0x1), timelock.address, recipient]
      [utils.getAddress(utils.hexZeroPad('0x01', 20)), timelock.address, newVaultOwner]
    );

    const mainnetActions = [
      // 1. Withdraw reserves from cWBTCv2
      {
        target: withdrawConfigV2.cWBTC2.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cWBTC2.amount, withdrawConfigV2.cWBTC2.decimals)]

        ),
      },
      // 2. Transfer withdrawn BTC to recipient
      {
        target: withdrawConfigV2.cWBTC2.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cWBTC2.amount, withdrawConfigV2.cWBTC2.decimals)]
        ),
      },
      // 3. Withdraw reserves from cUSDCv2
      {
        target: withdrawConfigV2.cUSDC.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cUSDC.amount, withdrawConfigV2.cUSDC.decimals)]
        ),
      },
      // 4. Transfer withdrawn USDC to recipient
      {
        target: withdrawConfigV2.cUSDC.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cUSDC.amount, withdrawConfigV2.cUSDC.decimals)]
        ),
      },
      // 5. Withdraw reserves from cETHv2
      {
        target: withdrawConfigV2.cETH.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cETH.amount, withdrawConfigV2.cETH.decimals)]
        ),
      },
      // 6. Transfer withdrawn ETH to recipient
      {
        target: recipient,
        signature: '',
        value: exp(withdrawConfigV2.cETH.amount, withdrawConfigV2.cETH.decimals),
        calldata: '0x',
      },
      // 7. Withdraw reserves from cUSDTv2
      {
        target: withdrawConfigV2.cUSDT.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cUSDT.amount, withdrawConfigV2.cUSDT.decimals)]
        ),
      },
      // 8. Transfer withdrawn USDT to recipient
      {
        target: withdrawConfigV2.cUSDT.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cUSDT.amount, withdrawConfigV2.cUSDT.decimals)]
        ),
      },
      // 9. Withdraw reserves from cBATv2
      {
        target: withdrawConfigV2.cBAT.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cBAT.amount, withdrawConfigV2.cBAT.decimals)]
        ),
      },
      // 10. Transfer withdrawn BAT to recipient
      {
        target: withdrawConfigV2.cBAT.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cBAT.amount, withdrawConfigV2.cBAT.decimals)]
        ),
      },
      // 11. Withdraw reserves from cUNIv2
      {
        target: withdrawConfigV2.cUNI.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cUNI.amount, withdrawConfigV2.cUNI.decimals)]
        ),
      },
      // 12. Transfer withdrawn UNI to recipient
      {
        target: withdrawConfigV2.cUNI.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cUNI.amount, withdrawConfigV2.cUNI.decimals)]
        ),
      },
      // 13. Withdraw reserves from cTUSDv2
      {
        target: withdrawConfigV2.cTUSD.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cTUSD.amount, withdrawConfigV2.cTUSD.decimals)]
        ),
      },
      // 14. Transfer withdrawn TUSD to recipient
      {
        target: withdrawConfigV2.cTUSD.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cTUSD.amount, withdrawConfigV2.cTUSD.decimals)]
        ),
      },
      // 15. Withdraw reserves from cLINKv2
      {
        target: withdrawConfigV2.cLINK.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cLINK.amount, withdrawConfigV2.cLINK.decimals)]
        ),
      },
      // 16. Transfer withdrawn LINK to recipient
      {
        target: withdrawConfigV2.cLINK.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cLINK.amount, withdrawConfigV2.cLINK.decimals)]
        ),
      },
      // 17. Withdraw reserves from cAAVEv2
      {
        target: withdrawConfigV2.cAAVE.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cAAVE.amount, withdrawConfigV2.cAAVE.decimals)]
        ),
      },
      // 18. Transfer withdrawn AAVE to recipient
      {
        target: withdrawConfigV2.cAAVE.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cAAVE.amount, withdrawConfigV2.cAAVE.decimals)]
        ),
      },
      // 19. Withdraw reserves from cCOMPv2
      {
        target: withdrawConfigV2.cCOMP.address,
        signature: '_reduceReserves(uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['uint256'],
          [exp(withdrawConfigV2.cCOMP.amount, withdrawConfigV2.cCOMP.decimals)]
        ),
      },
      // 20. Transfer withdrawn COMP to recipient
      {
        target: withdrawConfigV2.cCOMP.asset,
        signature: 'transfer(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV2.cCOMP.amount, withdrawConfigV2.cCOMP.decimals)]
        ),
      },
      // 21. Withdraw reserves from cUSDCv3
      {
        target: withdrawConfigV3.mainnet.cUSDCv3.address,
        signature: 'withdrawReserves(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [recipient, exp(withdrawConfigV3.mainnet.cUSDCv3.amount, withdrawConfigV3.mainnet.cUSDCv3.decimals)]
        ),
      },
      // 22. Send message to Optimism to trigger USDT withdrawal and bridging it back to Mainnet
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [OPTIMISM_BRIDGE_RECEIVER, optimismProposalData1, 2_500_000],
      },
      // 23. Send message to Optimism to trigger USDC withdrawal and bridging it back to Mainnet
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [OPTIMISM_BRIDGE_RECEIVER, optimismProposalData2, 2_500_000],
      },
      // 24. Send message to Base to trigger USDbC withdrawal and bridging it back to Mainnet
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [BASE_BRIDGE_RECEIVER, baseProposalData, 3_000_000]
      },
      // 25. Send message to Arbitrum to trigger USDC withdrawal and bridging it back to Mainnet
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          ARBITRUM_BRIDGE_RECEIVER,                         // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams1.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams1.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams1.maxFeePerGas*2,    // uint256 maxFeePerGas,
          arbitrumProposalData1,                             // bytes calldata data
        ],
        value: createRetryableTicketGasParams1.deposit.mul(2),
      },
      // 26. Send message to Arbitrum to trigger USDC.e withdrawal and bridging it back to Mainnet
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          ARBITRUM_BRIDGE_RECEIVER,                         // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams2.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams2.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams2.maxFeePerGas*2,    // uint256 maxFeePerGas,
          arbitrumProposalData2,                             // bytes calldata data
        ],
        value: createRetryableTicketGasParams2.deposit.mul(2),
      },
      // 27. Send message to Arbitrum to trigger WETH withdrawal and bridging it back to Mainnet
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          ARBITRUM_BRIDGE_RECEIVER,                         // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams3.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams3.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams3.maxFeePerGas*2,    // uint256 maxFeePerGas,
          arbitrumProposalData3,                             // bytes calldata data
        ],
        value: createRetryableTicketGasParams3.deposit.mul(2),
      },
      // 28. Transfer ownership of Aera vault to recipient
      {
        target: AERA_VAULT,
        signature: 'transferOwnership(address)',
        calldata: transferOwnershipCalldata,
      },
      // 29. Transfer ownership of generic vault to recipient
      {
        contract: avantgardeVault,
        signature: 'execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)',
        args: [
          AVANTGARDE_VAULT,
          0,
          swapOwnerCalldata,
          0,
          0,
          0,
          0,
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000006d903f6003cca6255D85CcA4D3B5E5146dC33925000000000000000000000000000000000000000000000000000000000000004101'
        ],
      },
    ];

    const WBTC = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cWBTC2.asset);
    const USDC = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUSDC.asset);
    const USDT = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUSDT.asset);
    const BAT = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cBAT.asset);
    const UNI = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUNI.asset);
    const TUSD = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cTUSD.asset);
    const LINK = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cLINK.asset);
    const AAVE = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cAAVE.asset);
    const COMP = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cCOMP.asset);
    const WETH = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cETH.asset);

    balancesBefore = {
      WBTC: await WBTC.balanceOf(recipient),
      USDC: await USDC.balanceOf(recipient),
      USDT: await USDT.balanceOf(recipient),
      BAT: await BAT.balanceOf(recipient),
      UNI: await UNI.balanceOf(recipient),
      TUSD: await TUSD.balanceOf(recipient),
      LINK: await LINK.balanceOf(recipient),
      AAVE: await AAVE.balanceOf(recipient),
      COMP: await COMP.balanceOf(recipient),
      ETH: BigNumber.from(await deploymentManager.hre.ethers.provider.getBalance(recipient)),
      WETH: await WETH.balanceOf(recipient),
    };

    const description = `# Establishment of Treasury Management Program and Treasury Management Committee

This proposal establishes the Compound Treasury Management Program (TMP) and deploys the on-chain infrastructure required to consolidate and manage protocol treasury assets under the oversight of a newly constituted Treasury Management Committee (TMC).

Upon execution, this proposal:

1. Withdraws deprecated V2 reserves (~$18.95M) to Treasury Escrow.
2. Transfers Aera vault ownership (~$28.21M) from the Governor Timelock to Treasury Timelock.
3. Transfers Avantgarde vault ownership (~$3.8M) from the Governor Timelock to Treasury Timelock.
4. Withdraws V3 surplus reserves (~$6.94M) above the reserve floor to Treasury Escrow.

All withdrawals from Treasury Escrow are subject to a 2-day cooldown before execution, a 7-day expiration window, and Safeguard cancellation rights. The Treasury Timelock enforces a 2-day minimum delay on governance-level operations. Both contracts have been audited by ChainSecurity and Certora.

### Audit

Treasury manager has been audited by [Certora](https://www.certora.com/) and the report can be found [here](https://www.certora.com/reports/compound-treasury-manager).

Full proposal details, fund source methodology, on-chain controls, and TMC composition: [Establishment of Treasury Management Program and Treasury Management Committee](https://www.comp.xyz/t/establishment-of-treasury-management-program-and-treasury-management-committee/7710).
`;
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 600_000
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const WBTC = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cWBTC2.asset);
    const USDC = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUSDC.asset);
    const USDT = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUSDT.asset);
    const BAT = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cBAT.asset);
    const UNI = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cUNI.asset);
    const TUSD = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cTUSD.asset);
    const LINK = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cLINK.asset);
    const AAVE = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cAAVE.asset);
    const COMP = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cCOMP.asset);
    const WETH = await getErc20FromAddress(deploymentManager, withdrawConfigV2.cETH.asset);

    const balancesAfter = {
      WBTC: await WBTC.balanceOf(recipient),
      USDC: await USDC.balanceOf(recipient),
      USDT: await USDT.balanceOf(recipient),
      BAT: await BAT.balanceOf(recipient),
      UNI: await UNI.balanceOf(recipient),
      TUSD: await TUSD.balanceOf(recipient),
      LINK: await LINK.balanceOf(recipient),
      AAVE: await AAVE.balanceOf(recipient),
      COMP: await COMP.balanceOf(recipient),
      ETH: BigNumber.from(await deploymentManager.hre.ethers.provider.getBalance(recipient)),
      WETH: await WETH.balanceOf(recipient),
    };

    const aeraVault = new Contract(
      AERA_VAULT,
      ['function pendingOwner() view returns (address)'],
      await deploymentManager.getSigner()
    );
    const pendingVaultOwner = await aeraVault.pendingOwner();
    expect(pendingVaultOwner).to.equal(newVaultOwner);

    const avantgardeVault = new Contract(
      AVANTGARDE_VAULT,
      ['function getOwners() view returns (address[])'],
      await deploymentManager.getSigner()
    );
    const vaultOwner2 = await avantgardeVault.getOwners();
    expect(vaultOwner2).to.deep.equal([newVaultOwner]);

    expect(balancesAfter.WBTC.sub(balancesBefore.WBTC)).to.equal(exp(withdrawConfigV2.cWBTC2.amount, withdrawConfigV2.cWBTC2.decimals));
    expect(balancesAfter.USDC.sub(balancesBefore.USDC)).to.equal(
      exp(withdrawConfigV2.cUSDC.amount, withdrawConfigV2.cUSDC.decimals) +
      exp(withdrawConfigV3.mainnet.cUSDCv3.amount, withdrawConfigV3.mainnet.cUSDCv3.decimals) +
      exp(withdrawConfigV3.optimism.cUSDCv3.amount, withdrawConfigV3.optimism.cUSDCv3.decimals) +
      exp(withdrawConfigV3.base.cUSDbCv3.amount, withdrawConfigV3.base.cUSDbCv3.decimals) +
      exp(withdrawConfigV3.arbitrum.cUSDCv3.amount, withdrawConfigV3.arbitrum.cUSDCv3.decimals) +
      exp(withdrawConfigV3.arbitrum.cUSDCev3.amount, withdrawConfigV3.arbitrum.cUSDCev3.decimals)    
    );
    expect(balancesAfter.USDT.sub(balancesBefore.USDT)).to.equal(
      exp(withdrawConfigV2.cUSDT.amount, withdrawConfigV2.cUSDT.decimals) +
      exp(withdrawConfigV3.optimism.cUSDTv3.amount, withdrawConfigV3.optimism.cUSDTv3.decimals)
    );
    expect(balancesAfter.BAT.sub(balancesBefore.BAT)).to.equal(exp(withdrawConfigV2.cBAT.amount, withdrawConfigV2.cBAT.decimals));
    expect(balancesAfter.UNI.sub(balancesBefore.UNI)).to.equal(exp(withdrawConfigV2.cUNI.amount, withdrawConfigV2.cUNI.decimals));
    expect(balancesAfter.TUSD.sub(balancesBefore.TUSD)).to.equal(exp(withdrawConfigV2.cTUSD.amount, withdrawConfigV2.cTUSD.decimals));
    expect(balancesAfter.LINK.sub(balancesBefore.LINK)).to.equal(exp(withdrawConfigV2.cLINK.amount, withdrawConfigV2.cLINK.decimals));
    expect(balancesAfter.AAVE.sub(balancesBefore.AAVE)).to.equal(exp(withdrawConfigV2.cAAVE.amount, withdrawConfigV2.cAAVE.decimals));
    expect(balancesAfter.COMP.sub(balancesBefore.COMP)).to.equal(exp(withdrawConfigV2.cCOMP.amount, withdrawConfigV2.cCOMP.decimals));
    expect(balancesAfter.ETH.sub(balancesBefore.ETH)).to.equal(exp(withdrawConfigV2.cETH.amount, withdrawConfigV2.cETH.decimals));
    expect(balancesAfter.WETH.sub(balancesBefore.WETH)).to.equal(exp(withdrawConfigV3.arbitrum.cWETHv3.amount, withdrawConfigV3.arbitrum.cWETHv3.decimals));
  },
});
