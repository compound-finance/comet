import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { expect } from 'chai';

const COMPAddress = '0x3587b2F7E0E2D6166d6C14230e7Fe160252B0ba4';
const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x19c2d5D0f035563344dBB7bE5fD09c8dad62b001';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const USDCAmountToSeed = exp(5, 6);

export default migration('1691022234_configurate_and_ens', {
  async prepare(deploymentManager: DeploymentManager) {
    const cometFactory = await deploymentManager.deploy('cometFactory', 'CometFactory.sol', [], true);
    return { newFactoryAddress: cometFactory.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { newFactoryAddress }) => {
    const trace = deploymentManager.tracer();

    // Import shared contracts from cUSDCv3

    const AllContracts = await deploymentManager.getContracts();
    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      rewards,
      USDT,
    } = AllContracts;

    const configuration = await getConfigurationStruct(deploymentManager);

    const ENSResolver = await deploymentManager.existing('ENSResolver', ENSResolverAddress, 'goerli');
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const chainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDT', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[chainId]) {
      officialMarketsJSON[chainId].push(newMarketObject);
    } else {
      officialMarketsJSON[chainId] = [newMarketObject];
    }

    const actions = [
      // 1. Set the factory in the Configurator
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, newFactoryAddress],
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
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      }, 

      // 6. Send USDT from Timelock to Comet
      // XXX assert that funds have been transferred by diffing the balances before and after
      {
        contract: USDT,
        signature: "transfer(address,uint256)",
        args: [comet.address, exp(20_000_000, 6)],
      },
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

    // Verify state changes
    // const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    // TODO: Will uncomment once the comet has been deployed
    // expect(stateChanges).to.deep.equal({
    //   COMP: {
    //     supplyCap: exp(500_000, 18)
    //   },
    //   WBTC: {
    //     supplyCap: exp(35_000, 8)
    //   },
    //   WETH: {
    //     supplyCap: exp(1_000_000, 18)
    //   },
    //   baseTrackingSupplySpeed: exp(34.74 / 86400, 15, 18),
    //   baseTrackingBorrowSpeed: exp(34.74 / 86400, 15, 18),
    // });

    expect(config.token).to.be.equal(COMPAddress);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // Verify the seeded USDT reaches Comet reserve
    expect(await comet.getReserves()).to.be.equal(exp(20_000_000, 6));

    // Verify the official markets are updated
    const ENSResolver = await deploymentManager.existing('ENSResolver', ENSResolverAddress, 'goerli');
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarkets = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

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
        {
          baseSymbol: 'USDT',
          cometAddress: comet.address,
        }
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
          cometAddress: '0x0C94d3F9D7F211630EDecAF085718Ac80821A6cA',
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
