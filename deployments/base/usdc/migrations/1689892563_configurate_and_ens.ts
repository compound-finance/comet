import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

export default migration('1689892563_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const cometFactory = await deploymentManager.fromDep('cometFactory', 'base', 'usdbc');
    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      USDC
    } = await deploymentManager.getContracts();

    const {
      baseL1CrossDomainMessenger,
      governor,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const baseChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDC', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[baseChainId]) {
      officialMarketsJSON[baseChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[baseChainId] = [newMarketObject];
    }

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
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, configurator.address, cometAdmin.address],
        [0, 0, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)'
        ],
        [setFactoryCalldata, setConfigurationCalldata, deployAndUpgradeToCalldata]
      ]
    );

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Base.
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 2_500_000]
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

    const description = "# Initialize cUSDCv3 on Base\n\nThis proposal takes the governance steps recommended and necessary to initialize a Compound III USDC market on Base; upon execution, cUSDCv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). Although real tests have also been run over the Goerli/Base Goerli bridge, this will be the first proposal to actually bridge from Ethereum mainnet to Base mainnet, and therefore includes risks not present in previous proposals.\n\nAlthough the proposal sets the entire configuration in the Configurator, the initial deployment already has most of these same parameters already set. The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/deploy-compound-iii-on-base/4402/2). Finally, the parameters include a modest reallocation of some of the v2 USDC supply-side COMP incentives to users in the new market.\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/792) and [forum discussion](https://www.comp.xyz/t/deploy-compound-iii-on-base/4402).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Base. This sends the encoded `setConfiguration` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Base. It also calls `setRewardConfig` on the Base rewards contract, to establish Base’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 30 COMP/day and borrow speed to be 15 COMP/day.\n\nThe second action approves Base’s [L1StandardBridge](https://etherscan.io/address/0x3154Cf16ccdb4C6d922629664174b904d80F2C35) to take the Timelock's USDC, in order to seed the market reserves through the bridge.\n\nThe third action deposits 10K USDC from mainnet to the Base L1StandardBridge contract to bridge to Comet.\n\nThe fourth action approves Base’s [L1StandardBridge](https://etherscan.io/address/0x3154Cf16ccdb4C6d922629664174b904d80F2C35) to take Timelock's COMP, in order to seed the rewards contract through the bridge.\n\nThe fifth action deposits 12.5K COMP from mainnet to the Base L1StandardBridge contract to bridge to CometRewards.\n\nThe sixth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Base cUSDbCv3 market.\n\nThe seventh action reduces the COMP distribution to v2 cUSDC suppliers by 45 COMP/day, so as to keep the total COMP distribution constant.";
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
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
    await deploymentManager.spider(); // We spider here to pull in Base COMP now that reward config has been set

    const {
      comet,
      rewards,
      COMP,
      USDC
    } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      baseTrackingSupplySpeed: exp(30 / 86400, 15, 18),
      baseTrackingBorrowSpeed: exp(15 / 86400, 15, 18),
      WETH: {
        supplyCap: exp(11000, 18)
      },
      cbETH: {
        supplyCap: exp(7500, 18)
      }
    });
  
    // TODO: Validate the reward config
    // const config = await rewards.rewardConfig(comet.address);
    // expect(config.token).to.be.equal(COMP.address);
    // expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    // expect(config.shouldUpscale).to.be.equal(true);

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
          baseSymbol: 'USDC.e',
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
        },
        {
          baseSymbol: 'USDC',
          cometAddress:'0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
        }
      ],
      8453: [
        {
          baseSymbol: 'USDbC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x46e6b214b524310239732D51387075E0e70970bf',
        }
      ],
    });

    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(30 / 86400, 15, 18));
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(15 / 86400, 15, 18));
  }
});