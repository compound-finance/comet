import { BigNumber, Contract, providers } from 'ethers';
import { expect } from 'chai';
import { L1ToL2MessageGasEstimator } from '@arbitrum/sdk';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';

const { INFURA_KEY } = process.env;

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

export default migration('1679020486_configurate_and_ens', {
  prepare: async (_deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
    } = await deploymentManager.getContracts();

    const {
      inbox,
      l1GatewayRouter,
      timelock,
      governor,
      USDC,
      COMP,
    } = await govDeploymentManager.getContracts();

    const l1Provider = new providers.JsonRpcProvider(`https://mainnet.infura.io/v3/${INFURA_KEY}`);
    const l2Provider = new providers.JsonRpcProvider(`https://arbitrum-mainnet.infura.io/v3/${INFURA_KEY}`);
    const gasEstimator = new L1ToL2MessageGasEstimator(l2Provider);

    const l1GatewayRouterInterace = l1GatewayRouter.interface;

    const USDCAmountToBridge = exp(10_000, 6);
    const COMPAmountToBridge = exp(2_500, 18);
    const usdcGatewayAddress = await l1GatewayRouter.getGateway(USDC.address);
    const compGatewayAddress = await l1GatewayRouter.getGateway(COMP.address);
    const refundAddress = comet.address; // XXX timelock address?

    const usdcDummyCallData = l1GatewayRouterInterace.encodeFunctionData(
      'outboundTransferCustomRefund',
      [
        USDC.address,                                                 // _token
        refundAddress,                                                // _refundTo
        comet.address,                                                // _to
        USDCAmountToBridge,                                           // _amount
        1,                                                            // _maxGas (aka gasLimit)
        1,                                                            // _gasPriceBid (aka maxFeePerGas)
        utils.defaultAbiCoder.encode(['uint256', 'bytes'], [1, '0x']) // _data
      ]
    );

    const compDummyCallData = l1GatewayRouterInterace.encodeFunctionData(
      'outboundTransferCustomRefund',
      [
        COMP.address,                                                 // _token
        refundAddress,                                                // _refundTo
        rewards.address,                                              // _to
        COMPAmountToBridge,                                           // _amount
        1,                                                            // _maxGas (aka gasLimit)
        1,                                                            // _gasPriceBid (aka maxFeePerGas)
        utils.defaultAbiCoder.encode(['uint256', 'bytes'], [1, '0x']) // _data
      ]
    );

    const usdcGasParams = await gasEstimator.estimateAll(
      {
        from: timelock.address,
        to: l1GatewayRouter.address,
        l2CallValue: BigNumber.from(0),
        excessFeeRefundAddress: refundAddress,
        callValueRefundAddress: refundAddress,
        data: usdcDummyCallData
      },
      (await l1Provider.getBlock('latest')).baseFeePerGas!, // must be the l1Provider
      l1Provider
    );

    const compGasParams = await gasEstimator.estimateAll(
      {
        from: timelock.address,
        to: l1GatewayRouter.address,
        l2CallValue: BigNumber.from(0),
        excessFeeRefundAddress: refundAddress,
        callValueRefundAddress: refundAddress,
        data: compDummyCallData
      },
      (await l1Provider.getBlock('latest')).baseFeePerGas!, // must be the l1Provider
      l1Provider
    );

    const configuration = await getConfigurationStruct(deploymentManager);

    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(comet.address, configuration)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)'
        ],
        [setConfigurationCalldata, deployAndUpgradeToCalldata]
      ]
    );

    const createRetryableTicketCallData = inbox.interface.encodeFunctionData(
      'createRetryableTicket',
      [
        bridgeReceiver.address, // address to,
        0,                      // uint256 l2CallValue,
        0,                      // uint256 maxSubmissionCost,
        refundAddress,          // address excessFeeRefundAddress,
        refundAddress,          // address callValueRefundAddress,
        0,                      // uint256 gasLimit,
        0,                      // uint256 maxFeePerGas,
        l2ProposalData          // bytes calldata data
      ]
    );

    const createRetryableTicketGasParams = await gasEstimator.estimateAll(
      {
        from: timelock.address,
        to: inbox.address,
        l2CallValue: BigNumber.from(0),
        excessFeeRefundAddress: refundAddress,
        callValueRefundAddress: refundAddress,
        data: createRetryableTicketCallData
      },
      (await l1Provider.getBlock('latest')).baseFeePerGas!, // must be the l1Provider
      l1Provider
    );

    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    const updatedMarkets = {
      ...officialMarkets,
      42161: [
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address,
        }
      ],
    };

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Arbitrum.
      {
        contract: inbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          bridgeReceiver.address,                           // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas,      // uint256 maxFeePerGas,
          l2ProposalData,                                   // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit
      },
      // 2. Approve the USDC gateway to take Timelock's USDC for bridging
      {
        contract: USDC,
        signature: 'approve(address,uint256)',
        args: [usdcGatewayAddress, USDCAmountToBridge]
      },
      // 3. Bridge USDC from mainnet to Arbitrum Comet
      {
        contract: l1GatewayRouter,
        signature: "outboundTransferCustomRefund(address,address,address,uint256,uint256,uint256,bytes)",
        args: [
          USDC.address,                             // address _token,
          refundAddress,                            // address _refundTo
          comet.address,                            // address _to,
          USDCAmountToBridge,                       // uint256 _amount,
          usdcGasParams.gasLimit,                   // uint256 _maxGas,
          usdcGasParams.maxFeePerGas,               // uint256 _gasPriceBid,
          utils.defaultAbiCoder.encode(
            ['uint256', 'bytes'],
            [usdcGasParams.maxSubmissionCost, '0x']
          )                                         // bytes calldata _data
        ],
        value: usdcGasParams.deposit
      },
      // 4. Approve the COMP gateway to take Timelock's COMP for bridging
      {
        contract: COMP,
        signature: 'approve(address,uint256)',
        args: [compGatewayAddress, COMPAmountToBridge]
      },
      // 5. Bridge COMP from mainnet to Arbitrum rewards
      {
        contract: l1GatewayRouter,
        signature: "outboundTransferCustomRefund(address,address,address,uint256,uint256,uint256,bytes)",
        args: [
          COMP.address,                             // address _token,
          refundAddress,                            // address _refundTo,
          rewards.address,                          // address _to,
          COMPAmountToBridge,                       // uint256 _amount,
          compGasParams.gasLimit,                   // uint256 _maxGas,
          compGasParams.maxFeePerGas,               // uint256 _gasPriceBid,
          utils.defaultAbiCoder.encode(
            ['uint256', 'bytes'],
            [compGasParams.maxSubmissionCost, '0x']
          )                                         // bytes calldata _data
        ],
        value: compGasParams.deposit
      },
      // 6. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(updatedMarkets)]
        )
      },
    ];

    const description = "XXX"; // XXX add description
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const ethers = deploymentManager.hre.ethers;

    const {
      comet,
      rewards,
      WBTC,
      WETH,
      LINK
    } = await deploymentManager.getContracts();

    // 1.
    const wbtcInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);
    const linkInfo = await comet.getAssetInfoByAddress(LINK.address);
    expect(wbtcInfo.supplyCap).to.be.eq(exp(400, 8));
    expect(wethInfo.supplyCap).to.be.eq(exp(11_000, 18));
    expect(linkInfo.supplyCap).to.be.eq(exp(10_000_000, 18));
    // XXX
    // expect(await comet.pauseGuardian()).to.be.eq('');

    // 2. & 3.
    expect(await comet.getReserves()).to.be.equal(exp(10_000, 6));

    // 4. & 5.
    const arbitrumCOMP = new Contract(
      '0x354a6da3fcde098f8389cad84b0182725c6c91de',
      ['function balanceOf(address account) external view returns (uint256)'],
      deploymentManager.hre.ethers.provider
    );
    expect(await arbitrumCOMP.balanceOf(rewards.address)).to.be.equal(exp(2_500, 18));

    // 6.
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    expect(officialMarkets).to.deep.equal({
      1: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xA17581A9E3356d9A858b789D68B4d866e593aE94',
        },
      ],

      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
        },
      ],

      42161: [
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address,
        }
      ],
    });
  }
});
