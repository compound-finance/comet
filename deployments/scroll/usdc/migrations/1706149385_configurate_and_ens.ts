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
const scrollCOMPAddress = '0x643e160a3C3E2B7eae198f0beB1BfD2441450e86';

export default migration('1706149385_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
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
      rewards
    } = await deploymentManager.getContracts();

    const {
      scrollMessenger,
      scrollL1USDCGateway,
      governor,
      USDC
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const scrollChainId = (
      await deploymentManager.hre.ethers.provider.getNetwork()
    ).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDC', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[scrollChainId]) {
      officialMarketsJSON[scrollChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[scrollChainId] = [newMarketObject];
    }

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
      [comet.address, scrollCOMPAddress]
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

    const USDCAmountToBridge = exp(10_000, 6);

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Scroll
      {
        contract: scrollMessenger,
        signature: 'sendMessage(address,uint256,bytes,uint256)',
        args: [bridgeReceiver.address, 0, l2ProposalData, 600_000],
        value: exp(0.1, 18)
      },

      // 2. Approve Scroll's L1 USDC Gateway to take Timelock's USDC (for bridging)
      {
        contract: USDC,
        signature: 'approve(address,uint256)',
        args: [scrollL1USDCGateway.address, USDCAmountToBridge]
      },
      // 3. Bridge USDC from Ethereum to Scroll Comet using L1 USDC Gateway
      {
        contract: scrollL1USDCGateway,
        signature: 'depositERC20(address,address,uint256,uint256)',
        args: [USDC.address, comet.address, USDCAmountToBridge, 300_000],
        value: exp(0.1, 18)
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

    const description =
      "# Initialize cUSDCv3 on Scroll\n\nThis proposal takes the governance steps recommended and necessary to initialize a Compound III USDC market on Scroll; upon execution, cUSDCv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). Although real tests have also been run over the Goerli/Scroll Alpha bridge, this will be the first proposal to actually bridge from Ethereum mainnet to Scroll mainnet, and therefore includes risks not present in previous proposals.\n\nAlthough the proposal sets the entire configuration in the Configurator, with parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/deploy-compound-iii-on-scroll/4917/3).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/824) and [forum discussion](https://www.comp.xyz/t/deploy-compound-iii-on-scroll/4917).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Scroll. This sends the encoded `setConfiguration` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Scroll. It also calls `setRewardConfig` on the Scroll rewards contract to establish Scroll’s bridged version of COMP as the reward token for the deployment (note that rewards speeds have been set to 0, as Gauntlet has recommended to hold off on including rewards in the comet deployment for now).\n\nThe second action approves Scroll’s [L1USDCGateway](https://etherscan.io/address/0xf1AF3b23DE0A5Ca3CAb7261cb0061C0D779A5c7B) to take Timelock's USDC, in order to seed the market reserves through the bridge.\n\nThe third action deposits 10K USDC from mainnet to the Scroll L1USDCGateway contract to bridge to Comet.\n\nThe fourth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Scroll cUSDCv3 market.";
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

  async verify(
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    preMigrationBlockNumber: number
  ) {
    const ethers = deploymentManager.hre.ethers;
    await deploymentManager.spider(); // We spider here to pull in Scroll COMP now that reward config has been set

    const { comet, rewards, COMP, USDC } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      baseTrackingSupplySpeed: exp(34.74 / 86400, 15, 18),
      baseTrackingBorrowSpeed: exp(34.74 / 86400, 15, 18),
      baseMinForRewards: exp(1000, 6),
      WETH: {
        borrowCollateralFactor: exp(0.775, 18),
        liquidationFactor: exp(0.95, 18),
        supplyCap: exp(1000, 18)
      },
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3.
    expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(1_000, 18));

    // 4
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    expect(officialMarkets).to.deep.equal({
      5: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x3EE77595A8459e93C2888b13aDB354017B198188'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x9A539EEc489AAA03D588212a164d0abdB5F08F5F'
        }
      ],
      80001: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF09F0369aB0a875254fB565E52226c88f10Bc839'
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
          baseSymbol: 'USDC',
          cometAddress: '0x1d573274E19174260c5aCE3f2251598959d24456'
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
      59140: [
        {
          baseSymbol: 'USDC',
          cometAddress: "0xa84b24A43ba1890A165f94Ad13d0196E5fD1023a"
        }
      ],
      534353: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x149B7023781d1D37689d447A565a1bf5854a8e3d'
        }
      ],
      534352: [
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address
        }
      ]
    });
  }

});
