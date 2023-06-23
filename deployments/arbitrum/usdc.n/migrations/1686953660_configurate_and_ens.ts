import { Contract } from 'ethers';
import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction, estimateTokenBridge } from '../../../../scenario/utils/arbitrumUtils';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

const arbitrumCOMPAddress = '0x354A6dA3fcde098F8389cad84b0182725c6C91dE';

export default migration('1686953660_configurate_and_ens', {
  prepare: async (_deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator,
      rewards,
    } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      arbitrumL1GatewayRouter,
      timelock,
      comptrollerV2,
      governor,
      USDC,
      COMP,
    } = await govDeploymentManager.getContracts();

    const refundAddress = l2Timelock.address;
    const configuration = await getConfigurationStruct(deploymentManager);

    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(comet.address, configuration)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [comet.address, arbitrumCOMPAddress]
    );
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address, rewards.address],
        [0, 0, 0],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)'
        ],
        [setConfigurationCalldata, deployAndUpgradeToCalldata, setRewardConfigCalldata]
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

    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const arbitrumChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDC', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[arbitrumChainId]) {
      officialMarketsJSON[arbitrumChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[arbitrumChainId] = [newMarketObject];
    }

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Arbitrum.
      {
        contract: arbitrumInbox,
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

      // 2. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      },
    ];

    // TODO: Will update this description to be more accurate once the contract is deployed
    const description = "# Configurate Arbitrum cUSDCv3 market for Native USDC native, and set ENS record for official markets";    
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number) {
    const ethers = deploymentManager.hre.ethers;
    await deploymentManager.spider(); // Pull in Arbitrum COMP now that reward config has been set

    const {
      comet,
      rewards
    } = await deploymentManager.getContracts();

    const {
      comptrollerV2
    } = await govDeploymentManager.getContracts();

    // 1.
    // TODO: Once contract is deploy and migrate to the right cap amount, will uncomment this to verify

    // const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    // expect(stateChanges).to.deep.equal({
    //   ARB: {
    //     supplyCap: exp(4_000_000, 18)
    //   },
    //   GMX: {
    //     supplyCap: exp(50_000, 18)
    //   },
    //   WETH: {
    //     supplyCap: exp(5_000, 18)
    //   },
    //   WBTC: {
    //     supplyCap: exp(300, 8)
    //   },
    //   baseTrackingSupplySpeed: exp(34.74 / 86400, 15, 18)
    // });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(arbitrumCOMPAddress);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2.
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
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
        }, 
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address,
        }
      ],
    });

    // 3.
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(34.74 / 86400, 15, 18));
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(0);
  }
});