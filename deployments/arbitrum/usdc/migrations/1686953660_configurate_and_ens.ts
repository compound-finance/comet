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

    const cometFactory = await deploymentManager.fromDep('cometFactory', 'arbitrum', 'usdc.e');
    const usdceComet = await deploymentManager.fromDep('usdceComet', 'arbitrum', 'usdc.e', 'comet');
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
      CCTPTokenMessenger,
    } = await govDeploymentManager.getContracts();

    const refundAddress = l2Timelock.address;
    const configuration = await getConfigurationStruct(deploymentManager);
    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, cometFactory.address)
    );
    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(comet.address, configuration)
    );
    const USDCAmountToBridge = exp(10_000, 6);
    // CCTP destination domain for Arbitrum
    const ArbitrumDestinationDomain = 3;
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

    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
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

    const description = "# Initialize native USDC market cUSDCv3 on Arbitrum\n\nThis proposal takes the governance steps recommended and necessary to initialize a Compound III USDC (native USDC on Arbitrum) market on Arbitrum; upon execution, cUSDCv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). Although real tests have also been run over the Goerli/Arbitrum Goerli, this will be the first proposal to mint native USDC on Arbitrum mainnet by burning USDC on mainnet via the `depositAndBurn` function on the Cross-Chain Transfer Protocol (CCTP) provided by Circle, and therefore includes risks not present in previous proposals.\n\nThe proposal sets the entire configuration in the Configurator to be the same as the existing bridged USDC.e market. Finally, the parameters include a migration of bridged USDC.e market supply-side COMP incentives to users in the new native USDC market.\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/789) and [forum discussion](https://www.comp.xyz/t/initialize-compound-iii-native-usdc-on-arbitrum/4542).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet Factory, Comet configuration and deploys a new Comet implementation on Arbitrum. This sends the encoded `setFactory`, `setConfiguration` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Arbitrum. It also calls `setRewardConfig` on the Arbitrum rewards contract, to establish Arbitrum’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 10 COMP/day and borrow speed to be 0 COMP/day. It calls another `setBaseTrackingSupplySpeed` and `setBaseTrackingBorrowSpeed` to set the supply speed and borrow speed of the existing USDC.e market to be 0 COMP/day. Lastly it calls `deployAndUpgradeTo` to deploy an updated Comet implementation for the existing bridged USDC.e market to have the new supply and borrow rewards speed.\n\nThe second action approves Circle’s Cross-Chain Transfer Protocol (CCTP)[TokenMessenger](https://etherscan.io/address/0xbd3fa81b58ba92a82136038b25adec7066af3155) to take the Timelock's USDC on Mainnet, in order to seed the market reserves through the CCTP.\n\nThe third action deposits and burns 10K USDC from mainnet via `depositForBurn` function on CCTP’s TokenMessenger contract to mint native USDC to Comet on Arbitrum.\n\nThe fourth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new native USDC market and renames the bridged USDC market’s baseSymbol to USDC.e from USDC.";    
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
    const usdceComet = await deploymentManager.fromDep('usdceComet', 'arbitrum', 'usdc.e', 'comet');
    const {
      comet,
      rewards, 
    } = await deploymentManager.getContracts();

    const {
      comptrollerV2
    } = await govDeploymentManager.getContracts();

    // 1. Verify state changes
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      ARB: {
        supplyCap: exp(4_000_000, 18)
      },
      GMX: {
        supplyCap: exp(50_000, 18)
      },
      WETH: {
        supplyCap: exp(5_000, 18)
      },
      WBTC: {
        supplyCap: exp(300, 8)
      },
      baseTrackingSupplySpeed: exp(10 / 86400, 15, 18),
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(arbitrumCOMPAddress);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);
    // Ensure proposal has set usdce market to 0
    expect(await usdceComet.baseTrackingSupplySpeed()).to.be.equal(0);
    expect(await usdceComet.baseTrackingBorrowSpeed()).to.be.equal(0);

    // 2 & 3.
    expect(await comet.getReserves()).to.be.equal(exp(10_000, 6));

    // 4.
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
      8453: [
        {
          baseSymbol: 'USDbC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf'
        }, 
        {
          baseSymbol: 'WETH',
          cometAddress: '0x46e6b214b524310239732D51387075E0e70970bf'
        }
      ],
      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
        },
      ],

      42161: [
        {
          baseSymbol: 'USDC.e',
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
        }, 
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address,
        }
      ],
    });
  }
});