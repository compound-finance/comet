import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { exp, getConfigurationStruct, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

const COMPAddress = '0x3587b2F7E0E2D6166d6C14230e7Fe160252B0ba4';
const ENSName = 'compound-community-licenses.eth';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = ENSSubdomainLabel + '.' + ENSName;
const ENSResolverAddress = '0x19c2d5D0f035563344dBB7bE5fD09c8dad62b001';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSTextRecordKey = 'v3-official-markets';

export default migration('1691022234_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();

    // Import shared contracts from cUSDCv3
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'goerli', 'usdc');

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      rewards,
    } = await deploymentManager.getContracts();

    const configuration = await getConfigurationStruct(deploymentManager);

    const ENSResolver = await deploymentManager.existing('ENSResolver', ENSResolverAddress, 'goerli');
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const arbitrumChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDT', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

    if (officialMarketsJSON[arbitrumChainId]) {
      officialMarketsJSON[arbitrumChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[arbitrumChainId] = [newMarketObject];
    }

    const actions = [
      // 1. Set the factory in the Configurator
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, cometFactory.address],
      },

      // 2. Set the configuration in the Configurator
      {
        contract: configurator,
        signature: 'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
        args: [comet.address, configuration],
      },

      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },

      // 4. Set the rewards configuration to COMP
      {
        contract: rewards,
        signature: "setRewardConfig(address,address)",
        args: [comet.address, COMPAddress],
      },

      // 5. Set the official markets text record on the subdomain
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, officialMarketsJSON]
        )
      }
    ];
    const description = "# Initialize cUSDTv3 on Goerli"
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
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
