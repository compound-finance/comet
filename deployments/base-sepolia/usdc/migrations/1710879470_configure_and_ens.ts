import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x8FADE66B79cC9f707aB26799354482EB93a5B7dD';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const baseSepoliaCOMPAddress = '0x2f535da74048c0874400f0371Fba20DF983A56e2';

export default migration('1710879470_configure_and_ens', {
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
      rewards,
    } = await deploymentManager.getContracts();

    const {
      baseL1CrossDomainMessenger,
      baseL1StandardBridge,
      governor,
      COMP: sepoliaCOMP,
    } = await govDeploymentManager.getContracts();

    // // ENS Setup
    // // See also: https://docs.ens.domains/contract-api-reference/name-processing
    // const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress, 'sepolia');
    // const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    // const chainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    // const newMarketObject = { baseSymbol: 'USDC', cometAddress: comet.address };
    // const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    // if (officialMarketsJSON[chainId]) {
    //   officialMarketsJSON[chainId].push(newMarketObject);
    // } else {
    //   officialMarketsJSON[chainId] = [newMarketObject];
    // }

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
      [comet.address, baseSepoliaCOMPAddress]
    );

    // Note reawrd config was already set in deploy, so it's not needed here
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address,
          // rewards.address
        ],
        [
          0,
          0,
          // 0
        ],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          // 'setRewardConfig(address,address)'
        ],
        [
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          // setRewardConfigCalldata
        ]
      ]
    );

    const COMPAmountToBridge = exp(10_000, 18);

    // Note: We aren't bridging USDC over to Base Sepolia because they don't use a bridged version of USDC there,
    const sepoliaActions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Base-Sepolia.
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 2_500_000]
      },

      // 2. Approve Sepolia's L1StandardBridge to take Timelock's COMP (for bridging)
      {
        contract: sepoliaCOMP,
        signature: 'approve(address,uint256)',
        args: [baseL1StandardBridge.address, COMPAmountToBridge]
      },

      // 3. Bridge COMP from Sepolia to Base-Sepolia Comet using L1StandardBridge
      {
        contract: baseL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature: 'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [sepoliaCOMP.address, baseSepoliaCOMPAddress, rewards.address, COMPAmountToBridge, 200_000, '0x']
      },

      // Note, no ENS set up on Sepolia
      // 4. Update the list of official markets
      // {
      //   target: ENSResolverAddress,
      //   signature: 'setText(bytes32,string,string)',
      //   calldata: ethers.utils.defaultAbiCoder.encode(
      //     ['bytes32', 'string', 'string'],
      //     [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
      //   )
      // },
    ];

    // const description = "# Configurate Base-Sepolia cUSDCv3 market, set reward config, bridge over USDC and COMP, and update ENS text record.";
    const description = "# Configure Base-Sepolia cUSDCv3 market, set reward config, and bridge over COMP.";
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(sepoliaActions, description))))
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
    await deploymentManager.spider(); // We spider here to pull in Optimism COMP now that reward config has been set

    const {
      comet,
      rewards,
      COMP,
    } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);

    //// Config was already set during deployment instead of subsequently with proposal.
    // expect(stateChanges).to.deep.equal({
    //   pauseGuardian: '0x6106DA3AcFdEB341808f4DC3D2483eC67c98E728',
    //   baseTrackingSupplySpeed: exp(34.74 / 86400, 15, 18),
    //   baseTrackingBorrowSpeed: exp(34.74 / 86400, 15, 18),
    //   baseBorrowMin: exp(1, 6),
    //   WETH: {
    //     supplyCap: exp(1000, 18)
    //   },
    //   cbETH: {
    //     supplyCap: exp(800, 18)
    //   }
    // })

    expect(stateChanges).to.deep.equal({});

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3.
    expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(10_000, 18));

    // ENS JSON string is not set up on Sepolia?

    // 4.
    // const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress, 'sepolia');
    // const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    // const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    // const officialMarkets = JSON.parse(officialMarketsJSON);
    // expect(officialMarkets).to.deep.equal({
    //   5: [
    //     {
    //       baseSymbol: 'USDC',
    //       cometAddress: '0x3EE77595A8459e93C2888b13aDB354017B198188',
    //     },
    //     {
    //       baseSymbol: 'WETH',
    //       cometAddress: '0x9A539EEc489AAA03D588212a164d0abdB5F08F5F',
    //     },
    //   ],
    //   80001: [
    //     {
    //       baseSymbol: 'USDC',
    //       cometAddress: '0xF09F0369aB0a875254fB565E52226c88f10Bc839',
    //     },
    //   ],
    //   420: [
    //     {
    //       baseSymbol: 'USDC',
    //       cometAddress: '0xb8F2f9C84ceD7bBCcc1Db6FB7bb1F19A9a4adfF4'
    //     }
    //   ],
    //   421613: [
    //     {
    //       baseSymbol: 'USDC',
    //       cometAddress: '0x1d573274E19174260c5aCE3f2251598959d24456'
    //     }
    //   ],
    //   84531: [
    //     {
    //       baseSymbol: 'USDC',
    //       cometAddress: comet.address,
    //     },
    //   ],
    // });
  }
});