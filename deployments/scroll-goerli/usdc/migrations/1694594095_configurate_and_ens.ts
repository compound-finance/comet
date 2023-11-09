import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x19c2d5D0f035563344dBB7bE5fD09c8dad62b001';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const scrollCOMPAddress = '0xE90a006650cda1F8390f95f45132B36bA9038bdF';
const scrollL1StandardERC20GatewayAddress = "0xeF37207c1A1efF6D6a9d7BfF3cF4270e406d319b"

export default migration('1694594095_configurate_and_ens', {
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
      scrollL1TokenBridge,
      governor,
      COMP,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress,
      'goerli'
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const scrollGoerliChainId = (
      await deploymentManager.hre.ethers.provider.getNetwork()
    ).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDC', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[scrollGoerliChainId]) {
      officialMarketsJSON[scrollGoerliChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[scrollGoerliChainId] = [newMarketObject];
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

    const COMPAmountToBridge = exp(10_000, 18);

    const goerliActions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Scroll Alpha.
      {
        contract: scrollMessenger,
        signature: 'sendMessage(address,uint256,bytes,uint256)',
        args: [bridgeReceiver.address, 0, l2ProposalData, 600_000]
      },

      // 2. Approve Goerli's StandardERC20Gateway to take Timelock's COMP (for bridging)
      {
        contract: COMP,
        signature: 'approve(address,uint256)',
        args: [scrollL1StandardERC20GatewayAddress, COMPAmountToBridge]
      },
      // 3. Bridge COMP from Goerli to Scroll Alpha Comet using L1GatewayRouter
      {
        contract: scrollL1TokenBridge,
        signature: 'depositERC20(address,address,uint256,uint256)',
        args: [COMP.address, rewards.address, COMPAmountToBridge, 300_000]
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
      '# Configurate Scroll Alpha cUSDCv3 market, set reward config, bridge over USDC and COMP, and update ENS text record.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(goerliActions, description))))
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
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress,
      'goerli'
    );
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
          cometAddress: comet.address
        }
      ]
    });
  }

});
