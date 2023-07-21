import { Contract } from 'ethers';
import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction, estimateTokenBridge } from '../../../../scenario/utils/arbitrumUtils';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x19c2d5D0f035563344dBB7bE5fD09c8dad62b001';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

const arbitrumCOMPAddress = '0xf03370d2aCf26Dde26389B66498B7c293038F5aF';

export default migration('1689112067_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const cometFactory = await deploymentManager.fromDep('cometFactory', 'arbitrum-goerli', 'usdc.e');
    const usdceComet = await deploymentManager.fromDep('usdceComet', 'arbitrum-goerli', 'usdc.e', 'comet');
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
      governor,
      USDC,
      COMP,
      CCTPTokenMessenger,
    } = await govDeploymentManager.getContracts();

    // CCTP destination domain for Arbitrum
    const ArbitrumDestinationDomain = 3;
    const USDCAmountToBridge = exp(10, 6);
    const refundAddress = l2Timelock.address;
    const configuration = await getConfigurationStruct(deploymentManager);
    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, cometFactory.address)
    );
    
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

    const turnOffUSDCeCometSupplySpeedCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint64'],
      [usdceComet.address, 0]
    );

    const turnOffUSDCeCometBorrowSpeedCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint64'],
      [usdceComet.address, 0]
    );

    const deployAndUpgradeToUSDCeCometCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, usdceComet.address]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, configurator.address, cometAdmin.address, rewards.address, configurator.address, configurator.address, cometAdmin.address],
        [0, 0, 0, 0, 0, 0, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
          'setBaseTrackingSupplySpeed(address,uint64)',
          'setBaseTrackingBorrowSpeed(address,uint64)',
          'deployAndUpgradeTo(address,address)',
        ],
        [setFactoryCalldata, setConfigurationCalldata, deployAndUpgradeToCalldata, setRewardConfigCalldata, turnOffUSDCeCometSupplySpeedCalldata, turnOffUSDCeCometBorrowSpeedCalldata, deployAndUpgradeToUSDCeCometCalldata]
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
    const arbitrumChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDC', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

    // Rename old USDC market into USDC.e
    officialMarketsJSON[arbitrumChainId][0].baseSymbol = 'USDC.e';

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
      // 2. Approve USDC to CCTP
      {
        contract: USDC,
        signature: 'approve(address,uint256)',
        args: [CCTPTokenMessenger.address, USDCAmountToBridge]
      },
      // 3. Burn USDC to Arbitrum via CCTP
      {
        contract: CCTPTokenMessenger,
        signature: 'depositForBurn(uint256,uint32,bytes32,address)',
        args: [USDCAmountToBridge, ArbitrumDestinationDomain, utils.hexZeroPad(comet.address, 32), USDC.address],
      },
      // 4. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      }
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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  }, 

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number) {
    const ethers = deploymentManager.hre.ethers;
    await deploymentManager.spider(); // Pull in Arbitrum COMP now that reward config has been set
    const usdceComet = await deploymentManager.fromDep('usdceComet', 'arbitrum-goerli', 'usdc.e', 'comet');
    const {
      comet,
      rewards,
    } = await deploymentManager.getContracts();

    const config = await rewards.rewardConfig(comet.address);

    // 1. Verify state changes
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      LINK: {
        supplyCap: exp(5_000_000, 18)
      },
      WETH: {
        supplyCap: exp(5_000, 18)
      },
      WBTC: {
        supplyCap: exp(300, 8)
      },
      baseTrackingSupplySpeed: exp(34.74 / 86400, 15, 18), 
      baseTrackingBorrowSpeed: exp(34.74 / 86400, 15, 18),
    });

    expect(config.token).to.be.equal(arbitrumCOMPAddress);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);
    // Ensure proposal has set usdce market to 0
    expect(await usdceComet.baseTrackingSupplySpeed()).to.be.equal(0);
    expect(await usdceComet.baseTrackingBorrowSpeed()).to.be.equal(0);
    
    // 2. & 3. Verify the seeded USDC reaches Comet reserve
    expect(await comet.getReserves()).to.be.equal(exp(10, 6));

    // 4. Verify the official markets are updated
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
          baseSymbol: 'USDC.e',
          cometAddress: '0x1d573274E19174260c5aCE3f2251598959d24456',
        },
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address
        },
      ],

      59140: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xa84b24A43ba1890A165f94Ad13d0196E5fD1023a'
        }
      ],

      84531: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xe78Fc55c884704F9485EDa042fb91BfE16fD55c1'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xED94f3052638620fE226a9661ead6a39C2a265bE'
        }
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
