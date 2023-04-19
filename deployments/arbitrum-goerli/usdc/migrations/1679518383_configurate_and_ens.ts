import { BigNumber, Contract, utils } from 'ethers';
import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x19c2d5D0f035563344dBB7bE5fD09c8dad62b001';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

// https://github.com/OffchainLabs/arbitrum/blob/master/packages/arb-bridge-eth/contracts/libraries/AddressAliasHelper.sol
function applyL1ToL2Alias(l1Address: string) {
  const offset = BigNumber.from('0x1111000000000000000000000000000000001111');
  return BigNumber.from(l1Address).add(offset).toHexString();
}

const gatewayInterface = new utils.Interface(
  [
    'function counterpartGateway() view external returns (address)',
    'function finalizeInboundTransfer(address _token, address _from, address _to, uint256 _amount, bytes calldata _data) external payable'
  ]
);

async function estimateL2Transaction(
  { from, to, data }: { to: string, from: string, data: string },
  l2DeploymentManager: DeploymentManager
) {
  // guess what the l1 gas price will be when the proposal is executed
  const l1GasPrice = (utils.parseUnits('100', 'gwei')).toNumber();
  // XXX add buffer?
  const l2GasPrice = (utils.parseUnits('0.1', 'gwei')).toNumber();

  const l2GasEstimateHex = await l2DeploymentManager.hre.network.provider.send(
    'eth_estimateGas',
    [{ from, to, data }]
  );
  const l2GasEstimate = BigNumber.from(l2GasEstimateHex);

  // Add overhead to cover retryable ticket creation etc
  const gasBuffer = 0; // XXX
  const l2GasLimit = BigNumber.from(gasBuffer).add(l2GasEstimate.mul(3).div(2));

  const bytesLength = utils.hexDataLength(data);
  // https://etherscan.io/address/0x5aed5f8a1e3607476f1f81c3d8fe126deb0afe94#code
  // calculateRetryableSubmissionFee
  const submissionCost = (1400 + 6 * bytesLength) * l1GasPrice;
  const submissionCostWithMargin = utils.parseUnits('10', 'gwei').add(submissionCost);

  const deposit = submissionCostWithMargin.add(l2GasLimit.mul(l2GasPrice));

  // XXX add l2CallValue?
  return {
    // gasLimit/maxGas
    gasLimit: l2GasLimit,
    // maxFeePerGas/gasPriceBid
    maxFeePerGas: l2GasPrice,
    // maxSubmissionCost/maxSubmissionFee
    maxSubmissionCost: submissionCostWithMargin,
    // deposit
    deposit
  };
}

async function estimateTokenBridge(
  { to, from, token, amount }: {to: string, from: string, token: string, amount: bigint},
  l1DeploymentManager: DeploymentManager,
  l2DeploymentManager: DeploymentManager
) {
  const { l1GatewayRouter } = await l1DeploymentManager.getContracts();

  const l1GatewayAddress = await l1GatewayRouter.getGateway(token);
  const l1Gateway = new Contract(
    l1GatewayAddress,
    gatewayInterface,
    l1DeploymentManager.hre.ethers.provider
  );
  const l2GatewayAddress = await l1Gateway.counterpartGateway();

  const data = gatewayInterface.encodeFunctionData(
    'finalizeInboundTransfer',
    [
      token,  // address _token,
      from,   // address _from,
      to,     // address _to,
      amount, // uint256 _amount,
      utils.defaultAbiCoder.encode(
        ['bytes', 'bytes'], ['0x', '0x']
      ) // bytes calldata _data
    ]
  );

  return await estimateL2Transaction(
    {
      from: applyL1ToL2Alias(l1GatewayAddress),
      to: l2GatewayAddress,
      data
    },
    l2DeploymentManager
  );
}

export default migration('1679518383_configurate_and_ens', {
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

    const USDCAmountToBridge = exp(10_000, 6);
    const COMPAmountToBridge = exp(2_500, 18);
    const usdcGatewayAddress = await l1GatewayRouter.getGateway(USDC.address);
    const compGatewayAddress = await l1GatewayRouter.getGateway(COMP.address);
    const refundAddress = comet.address; // XXX timelock address?

    const compGasParams = await estimateTokenBridge(
      {
        token: COMP.address,
        from: timelock.address,
        to: rewards.address,
        amount: COMPAmountToBridge
      },
      govDeploymentManager,
      deploymentManager
    );

    const usdcGasParams = await estimateTokenBridge(
      {
        token: USDC.address,
        from: timelock.address,
        to: comet.address,
        amount: USDCAmountToBridge
      },
      govDeploymentManager,
      deploymentManager
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

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData
      },
      deploymentManager
    );

    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress, 'goerli');
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    // XXX
    const updatedMarkets = {
      ...officialMarkets,
      421613: [
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
        signature: 'outboundTransferCustomRefund(address,address,address,uint256,uint256,uint256,bytes)',
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
        signature: 'outboundTransferCustomRefund(address,address,address,uint256,uint256,uint256,bytes)',
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

    const description = 'XXX'; // XXX add description
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
      WETH,
      LINK
    } = await deploymentManager.getContracts();

    // 1.
    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);
    const linkInfo = await comet.getAssetInfoByAddress(LINK.address);
    expect(wethInfo.supplyCap).to.be.eq(exp(11_000, 18));
    expect(linkInfo.supplyCap).to.be.eq(exp(10_000_000, 18));
    // XXX
    // expect(await comet.pauseGuardian()).to.be.eq('');

    // 2. & 3.
    expect(await comet.getReserves()).to.be.equal(exp(10_000, 6));

    // 4. & 5.
    const arbitrumCOMP = new Contract(
      '0xf03370d2aCf26Dde26389B66498B7c293038F5aF',
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
      5: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x3EE77595A8459e93C2888b13aDB354017B198188',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x9A539EEc489AAA03D588212a164d0abdB5F08F5F',
        },
      ],

      420: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xb8F2f9C84ceD7bBCcc1Db6FB7bb1F19A9a4adfF4'
        }
      ],

      421613: [
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address
        },
      ],

      80001: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF09F0369aB0a875254fB565E52226c88f10Bc839'
        },
      ]
    });
  }
});
