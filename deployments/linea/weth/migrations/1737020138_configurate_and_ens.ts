import { utils } from 'ethers';
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

const WETHAmountToBridge = exp(25, 18);

export default migration('1737020138_configurate_and_ens', {
  prepare: async (_deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();
    
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'linea', 'usdc');
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
      governor
    } = await govDeploymentManager.getContracts();

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
      [comet.address, lineaCOMPAddress]
    );
    const sweepNativeTokenCalldata = await calldata(bridgeReceiver.populateTransaction.sweepNativeToken(l2Timelock.address));
    const transferCalldata = await calldata(WETH.populateTransaction.transfer(comet.address, WETHAmountToBridge));

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          cometAdmin.address,
          rewards.address,
          bridgeReceiver.address,
          WETH.address,
          WETH.address
        ],
        [0, 0, 0, 0, 0, WETHAmountToBridge, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
          'sweepNativeToken(address)',
          'deposit()',
          'transfer(address,uint256)'
        ],
        [
          setFactoryCalldata,
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata,
          sweepNativeTokenCalldata,
          '0x',
          transferCalldata
        ]
      ]
    );

    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = utils.namehash(ENSSubdomain);
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    const newMarketObject = { baseSymbol: 'WETH', cometAddress: comet.address };

    if (officialMarketsJSON[59144]) {
      officialMarketsJSON[59144].push(newMarketObject);
    } else {
      officialMarketsJSON[59144] = [newMarketObject];
    }

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Linea.
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [bridgeReceiver.address, 0, l2ProposalData],
        value: WETHAmountToBridge
      },
      // 2. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      }
    ];

    const description = '# Initialize cWETHv3 on Linea network\n\n## Proposal summary\n\nWOOF! proposes the deployment of Compound III to the Linea network. This proposal takes the governance steps recommended and necessary to initialize a Compound III WETH market on Linea; upon execution, cWETHv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/deploy-compound-iii-on-linea/4460/20).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/982), [deploy market GitHub action run](https://github.com/woof-software/comet/actions/runs/15211470652) and [forum discussion](https://www.comp.xyz/t/deploy-compound-iii-on-linea/4460).\n\n\n## Proposal Actions\n\nThe first proposal action sends ether to the Linea Timelock so it can be wrapped and used to seed the reserves, sets the Comet configuration and deploys a new Comet implementation on Linea. This sends the encoded `setFactory`, `setConfiguration`, `deployAndUpgradeTo` calls across the bridge to the governance receiver on Linea.\n\nThe second action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Linea cWETHv3 market.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find((event: { event: string }) => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return true;
  },

  async verify(
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    preMigrationBlockNumber: number
  ) {
    await deploymentManager.spider(); // Pull in Linea COMP now that reward config has been set

    const {
      comet,
      rewards,
    } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      ezETH: {
        supplyCap: exp(4830, 18)
      },
      wstETH: {
        supplyCap: exp(260, 18)
      },
      WBTC: {
        supplyCap: exp(5, 8)
      },
      weETH: {
        supplyCap: exp(3550, 18)
      },
      wrsETH: {
        supplyCap: exp(500, 18)
      },
      baseTrackingSupplySpeed: exp(6 / 86400, 15, 18), // 69444444444
      baseTrackingBorrowSpeed: exp(4 / 86400, 15, 18), // 46296296296
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(lineaCOMPAddress);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3.
    expect(await comet.getReserves()).to.be.equal(WETHAmountToBridge);

    // 6.
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = utils.namehash(ENSSubdomain);
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
        },
        {
          baseSymbol: 'WBTC',
          cometAddress: '0xe85Dc543813B8c2CFEaAc371517b925a166a9293'
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
      130: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x2c7118c4C88B9841FCF839074c26Ae8f035f2921'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x6C987dDE50dB1dcDd32Cd4175778C2a291978E2a'
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
      2020: [
        {
          baseSymbol: 'WETH',
          cometAddress: '0x4006eD4097Ee51c09A04c3B0951D28CCf19e6DFE'
        },
        {
          baseSymbol: 'WRON',
          cometAddress: '0xc0Afdbd1cEB621Ef576BA969ce9D4ceF78Dbc0c0'
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
        },
        {
          baseSymbol: 'USDS',
          cometAddress: '0x2c776041CCFe903071AF44aa147368a9c8EEA518'
        }
      ],
      42161: [
        {
          baseSymbol: 'USDC.e',
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA'
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07'
        }
      ],
      59144: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: comet.address
        }
      ],
      534352: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44'
        }
      ]
    });
  }
});
