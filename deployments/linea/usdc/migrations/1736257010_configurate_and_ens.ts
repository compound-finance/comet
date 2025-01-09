import { Contract } from 'ethers';
import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

const lineaCOMPAddress = '';


export default migration('1736257010_configurate_and_ens', {
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
      lineaMessageService,
      lineaL1TokenBridge,
      governor,
      USDC,
      COMP,
    } = await govDeploymentManager.getContracts();

    const USDCAmountToBridge = exp(10_000, 6);
    const COMPAmountToBridge = exp(12_500, 18);
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
      [comet.address, lineaCOMPAddress]
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

    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    const updatedMarkets = {
      ...officialMarkets,
      42161: [
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address,
        }
      ],
    };

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Linea.
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [bridgeReceiver.address, 0, l2ProposalData]
      },
      // 2. Approve the USDC gateway to take Timelock's USDC for bridging
      {
        contract: USDC,
        signature: 'approve(address,uint256)',
        args: [lineaL1TokenBridge, USDCAmountToBridge]
      },
      // 3. Bridge USDC from mainnet to Linea Comet
      {
        contract: lineaL1TokenBridge,
        signature: 'bridgeToken(address,uint256,address)',
        args: [USDC.address, COMPAmountToBridge, refundAddress]
      },
      // 4. Approve the COMP gateway to take Timelock's COMP for bridging
      {
        contract: COMP,
        signature: 'approve(address,uint256)',
        args: [lineaL1TokenBridge, COMPAmountToBridge]
      },
      // 5. Bridge COMP from mainnet to Linea rewards
      {
        contract: lineaL1TokenBridge,
        signature: 'bridgeToken(address,uint256,address)',
        args: [COMP.address, COMPAmountToBridge, rewards.address]
      },
      // 6. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(updatedMarkets)]
        )
      }
    ];

    const description = 'DESCRIPTION';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number) {
    const ethers = deploymentManager.hre.ethers;
    await deploymentManager.spider(); // Pull in Linea COMP now that reward config has been set

    const {
      comet,
      rewards
    } = await deploymentManager.getContracts();

    // 1.
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
      baseTrackingSupplySpeed: exp(34.74 / 86400, 15, 18)
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(lineaCOMPAddress);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3.
    expect(await comet.getReserves()).to.be.equal(exp(10_000, 6));

    // 4. & 5.
    const lineaCOMP = new Contract(
      lineaCOMPAddress,
      ['function balanceOf(address account) external view returns (uint256)'],
      deploymentManager.hre.ethers.provider
    );
    expect(await lineaCOMP.balanceOf(rewards.address)).to.be.equal(exp(12_500, 18));

    // 6.
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
          cometAddress: comet.address,
        }
      ],
    });

    // 7.
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(34.74 / 86400, 15, 18) );
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(0);
  }
});
