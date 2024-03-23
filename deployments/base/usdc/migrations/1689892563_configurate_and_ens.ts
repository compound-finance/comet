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
const baseCOMPAddress = '0x9e1028F5F1D5eDE59748FFceE5532509976840E0';

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
      rewards
    } = await deploymentManager.getContracts();

    const {
      baseL1CrossDomainMessenger,
      governor,
      COMP: mainnetCOMP
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
    const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [comet.address, baseCOMPAddress]
    );
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, configurator.address, cometAdmin.address, rewards.address],
        [0, 0, 0, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)'
        ],
        [setFactoryCalldata, setConfigurationCalldata, deployAndUpgradeToCalldata, setRewardConfigCalldata]
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
      
      // 3. Send 108 COMP to arr00
      {
        contract: mainnetCOMP,
        signature: 'transfer(address,uint256)',
        args: ['0x2B384212EDc04Ae8bB41738D05BA20E33277bf33', exp(115, 18)]
      }
    ];

    const description = '# Initialize cUSDCv3 on Base\n\nThis proposal initializes the Compound III USDC market on Base as a first step to fully migrating to native USDC on base. The entirety of this proposal was simulated and indicates success. The [parameters for this deployment](https://www.comp.xyz/t/gauntlet-usdc-native-comet-market-to-compound-base-02-09-24/4982) and the [rewards configuration](https://www.comp.xyz/t/gauntlet-native-usdc-base-comet-incentives-recommendations/5009) were recommended by Gauntlet.\n\nSee links for more details:\n- [proposal pull request](https://github.com/compound-finance/comet/pull/828)\n- [forum discussion](https://www.comp.xyz/t/gauntlet-usdc-native-comet-market-to-compound-base-02-09-24/4982)\n\n## Proposal Actions\n1) The first proposal action sets the configurator factory address, sets Comet configuration, and deploys a new Comet implementation on Base. It also sets the rewards config for the new market to 20 COMP/Day for suppliers and 8 COMP/Day for borrowers.\n2) The second action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Base cUSDCv3 market.\n3) The third action pays arr00 115 COMP for the development effort for this proposal.';
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
      COMP
    } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      baseTrackingSupplySpeed: exp(20 / 86400, 15, 18),
      baseTrackingBorrowSpeed: exp(8 / 86400, 15, 18),
      WETH: {
        supplyCap: exp(11000, 18)
      },
      cbETH: {
        supplyCap: exp(7500, 18)
      }
    });
  
    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
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
        },
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address,
        }
      ],
    });

    // 20 comp per day to suppliers
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(20 / 86400, 15, 18));
    // 8 comp per day to borrowers
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(8 / 86400, 15, 18));
  }
});