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

const lineaCOMPAddress = '0x0ECE76334Fb560f2b1a49A60e38Cf726B02203f0';

const WETHAmountToBridge = exp(200, 18);
const COMPAmountToBridge = exp(2_500, 18);

export default migration('1737020138_configurate_and_ens', {
  prepare: async (_deploymentManager: DeploymentManager) => {
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
      timelock: l2Timelock,
      WETH
    } = await deploymentManager.getContracts();

    const {
      lineaMessageService,
      lineaL1TokenBridge,
      governor,
      COMP,
    } = await govDeploymentManager.getContracts();

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
    const sweepNativeTokenCalldata = await calldata(bridgeReceiver.populateTransaction.sweepNativeToken(l2Timelock.address));
    const transferCalldata = await calldata(WETH.populateTransaction.transfer(comet.address, WETHAmountToBridge));

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address, cometAdmin.address, rewards.address, bridgeReceiver.address, WETH.address, WETH.address
        ],
        [0, 0, 0, 0, WETHAmountToBridge, 0],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
          'sweepNativeToken(address)',
          'deposit()',
          'transfer(address,uint256)'
        ],
        [
          setConfigurationCalldata, deployAndUpgradeToCalldata,  setRewardConfigCalldata, sweepNativeTokenCalldata, '0x', transferCalldata
        ]
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
          baseSymbol: 'WETH',
          cometAddress: comet.address,
        }
      ],
    };
    // 200 000000000000000000
    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Linea.
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [bridgeReceiver.address, 0, l2ProposalData],
        value: WETHAmountToBridge
      },
      // 4. Approve the COMP gateway to take Timelock's COMP for bridging
      {
        contract: COMP,
        signature: 'approve(address,uint256)',
        args: [lineaL1TokenBridge.address, COMPAmountToBridge]
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
      rewards,
    } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    // expect(stateChanges).to.deep.equal({
    //   ezETH: {
    //     supplyCap: exp(7200, 18)
    //   },
    //   wstETH: {
    //     supplyCap: exp(500, 18)
    //   },
    //   WBTC: {
    //     supplyCap: exp(22, 8)
    //   },
    //   weETH: {
    //     supplyCap: exp(4600, 18)
    //   },
    //   wrsETH: {
    //     supplyCap: exp(1150, 18)
    //   },
    //   baseTrackingSupplySpeed: exp(10 / 86400, 15, 18),
    //   baseTrackingBorrowSpeed: exp(4 / 86400, 15, 18)
    // });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(lineaCOMPAddress);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3.
    expect(await comet.getReserves()).to.be.equal(WETHAmountToBridge);

    // 4. & 5.
    const lineaCOMP = new Contract(
      lineaCOMPAddress,
      ['function balanceOf(address account) external view returns (uint256)'],
      deploymentManager.hre.ethers.provider
    );
    expect(await lineaCOMP.balanceOf(rewards.address)).to.be.equal(COMPAmountToBridge);

    // 6.
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    expect(officialMarkets).to.deep.equal({
      1: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xA17581A9E3356d9A858b789D68B4d866e593aE94'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840'
        },
        {
          baseSymbol: 'wstETH',
          cometAddress: '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3'
        },
        {
          baseSymbol: 'USDS',
          cometAddress: '0x5D409e56D886231aDAf00c8775665AD0f9897b56'
        }
      ],
      10: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xE36A30D249f7761327fd973001A32010b521b6Fd'
        }
      ],
      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xaeB318360f27748Acb200CE616E389A6C9409a07'
        }
      ],
      5000: [
        {
          baseSymbol: 'USDe',
          cometAddress: '0x606174f62cd968d8e684c645080fa694c1D7786E'
        }
      ],
      8453: [
        {
          baseSymbol: 'USDbC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x46e6b214b524310239732D51387075E0e70970bf'
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0xb125E6687d4313864e53df431d5425969c15Eb2F'
        },
        {
          baseSymbol: 'AERO',
          cometAddress: '0x784efeB622244d2348d4F2522f8860B96fbEcE89'
        }
      ],
      534352: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44'
        },
      ],
      42161: [
        {
          baseSymbol: 'WETH',
          cometAddress: comet.address,
        }
      ],
    });

    // 7.
    // expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(10 / 86400, 15, 18)); // 115740740740
    // expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(4 / 86400, 15, 18));  // 46296296296
  }
});
