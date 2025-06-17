import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import {
  calldata,
  exp,
  getConfigurationStruct,
  proposal,
} from '../../../../src/deploy';
import { expect } from 'chai';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';
import { utils, Contract, constants } from 'ethers';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const unichainCOMPAddress = '0xdf78e4f0a8279942ca68046476919a90f2288656';
const wethAmountToBridge = exp(100, 18);
const COMPAmountToBridge = exp(3600, 18);

export default migration('1745497918_configurate_and_ens', {
  prepare: async () => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();
    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      cometFactory,
      WETH,
      timelock,
      COMP: COMP_L2,
    } = await deploymentManager.getContracts();

    const {
      unichainL1CrossDomainMessenger,
      unichainL1StandardBridge,
      governor,
      COMP: COMP_L1,
      comptrollerV2,
      timelock: timelockL1,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = utils.namehash(ENSSubdomain);
    const unichainChainId = 130;
    const newMarketObject = { baseSymbol: 'WETH', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(
      await ENSResolver.text(subdomainHash, ENSTextRecordKey)
    );
    if (officialMarketsJSON[unichainChainId]) {
      officialMarketsJSON[unichainChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[unichainChainId] = [newMarketObject];
    }

    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(
        comet.address,
        cometFactory.address
      )
    );
    const configuration = await getConfigurationStruct(deploymentManager);
    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(
        comet.address,
        configuration
      )
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [comet.address, unichainCOMPAddress]
    );
    const depositCalldata = await calldata(WETH.populateTransaction.deposit());
    const transferCalldata = await calldata(WETH.populateTransaction.transfer(comet.address, wethAmountToBridge));

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          cometAdmin.address,
          rewards.address,
          WETH.address,
          WETH.address,
        ],
        [0, 0, 0, 0, wethAmountToBridge, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
          'deposit()',
          'transfer(address,uint256)',
        ],
        [
          setFactoryCalldata,
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata,
          depositCalldata,
          transferCalldata
        ],
      ]
    );

    const actions = [
      // 1. Bridge 100 ETH from Ethereum to Unichain Rewards using L1StandardBridge
      {
        contract: unichainL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature:
          'depositETHTo(address,uint32,bytes)',
        args: [
          timelock.address,
          200_000,
          '0x',
        ],
        value: wethAmountToBridge
      },
      // 2. Grant 3,600 COMP to Timelock
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args: [timelockL1.address, COMPAmountToBridge],
      },
      // 3. Approve L1StandardBridge to transfer COMP
      {
        contract: COMP_L1,
        signature: 'approve(address,uint256)',
        args: [unichainL1StandardBridge.address, COMPAmountToBridge],
      },
      // 4. Bridge COMP from Ethereum to Unichain Rewards using L1StandardBridge
      {
        contract: unichainL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature:
          'bridgeERC20To(address,address,address,uint256,uint32,bytes)',
        args: [
          COMP_L1.address,
          COMP_L2.address,
          rewards.address,
          COMPAmountToBridge,
          200_000,
          '0x',
        ],
      },
      // 5. Set Comet configuration + deployAndUpgradeTo new Comet, set Reward Config on Unichain
      {
        contract: unichainL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000],
      },
      // 6. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },
    ];

    // the description has speeds. speeds will be set up on on-chain proposal
    const description = '# Initialize cWETHv3 on Unichain\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes the deployment of Compound III to the Unichain network. This proposal takes the governance steps recommended and necessary to initialize a Compound III WETH market on Unichain; upon execution, cWETHv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/alphagrowth-add-market-eth-on-unichain/6712/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/983), [deploy market GitHub action run](https://github.com/woof-software/comet/actions/runs/14789485605) and [forum discussion](https://www.comp.xyz/t/alphagrowth-add-market-eth-on-unichain/6712).\n\n\n## Price feeds\n\nFor wstETH deployment, uses market rate price feed whereas for ezETH and weETH, exchange price feeds are used. The price feed provider is Redstone as on the USDC Unichain market.\n\n## Proposal Actions\n\nThe first action bridges 100 ETH as seed reserves from Mainnet Timelock to Unichain L2 Timelock using UnichainL1StandardBridge.\n\nThe second action transfers 3,600 COMP as rewards from the Comptroller to Timelock.\n\nThe third action approves 3,600 COMP to be bridged to Unichain via UnichainL1StandardBridge.\n\nThe fourth action bridges 3,600 COMP to Unichain via UnichainL1StandardBridge.\n\nThe fifth proposal action sets the Comet configuration and deploys a new Comet implementation on Unichain. This sends the encoded `setFactory`, `setConfiguration`, `deployAndUpgradeTo`and `setRewardConfig` calls across the bridge to the governance receiver on Unichain. Supply rewards are 12 COMP per day, and borrow rewards are 8 COMP per day. Finally, bridged ETH is wrapped to WETH and transferred to Comet as seed reserves.\n\nThe sixth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Unichain cWETHv3 market.';
    const txn = await govDeploymentManager.retry(async () => {
      return trace(await governor.propose(...(await proposal(actions, description))));
    }
    );

    const event = txn.events.find((event) => event.event === 'ProposalCreated');
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
    const {
      comet,
      rewards,
      COMP
    } = await deploymentManager.getContracts();

    const {
      timelock
    } = await govDeploymentManager.getContracts();

    // 2.
    // uncomment on on-chain proposal PR
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      WBTC: {
        supplyCap: exp(120, 8)
      },
      ezETH: {
        supplyCap: exp(2200, 18)
      },
      wstETH: {
        supplyCap: exp(5000, 18)
      },
      weETH: {
        supplyCap: exp(5000, 18)
      },
      UNI: {
        supplyCap: exp(500_000, 18)
      },
      baseTrackingSupplySpeed: exp(12 / 86400, 15, 18), // 138888888888
      baseTrackingBorrowSpeed: exp(8 / 86400, 15, 18),  //  92592592592
    });

    const cometNew = new Contract(
      comet.address,
      [
        'function assetList() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddress = await cometNew.assetList();

    expect(assetListAddress).to.not.be.equal(constants.AddressZero);

    const pauseGuardian = new Contract(
      await comet.pauseGuardian(),
      [
        'function getOwners() external view returns (address[] memory)',
      ],
      await deploymentManager.getSigner()
    );

    const hreMainnet = await forkedHreForBase({ name: '', network: 'mainnet', deployment: '' });
    const dm = new DeploymentManager('mainnet', 'usdc', hreMainnet);

    const cometMainnet = await dm.contract('comet') as Contract;
    const guardian = await cometMainnet.pauseGuardian();
    const GnosisSafeContract = new Contract(
      guardian,
      [
        'function getOwners() external view returns (address[] memory)',
      ],
      await dm.getSigner()
    );
    const ownersMainnet = await GnosisSafeContract.getOwners();

    const owners = await pauseGuardian.getOwners();
    expect(owners).to.deep.equal(ownersMainnet);
    expect(owners.length).to.not.be.equal(0);

    // 1. Seed reserves
    expect(await comet.getReserves()).to.be.equal(wethAmountToBridge);

    // 2, 3, 4. COMP rewards
    expect(await COMP.balanceOf(rewards.address)).to.be.greaterThanOrEqual(COMPAmountToBridge as any);

    // 6.
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const ENSRegistry = await govDeploymentManager.existing('ENSRegistry', ENSRegistryAddress, 'mainnet');
    const subdomainHash = utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(
      subdomainHash,
      ENSTextRecordKey
    );
    expect(await ENSRegistry.recordExists(subdomainHash)).to.be.equal(true);
    expect(await ENSRegistry.owner(subdomainHash)).to.be.equal(timelock.address);
    expect(await ENSRegistry.resolver(subdomainHash)).to.be.equal(ENSResolverAddress);
    expect(await ENSRegistry.ttl(subdomainHash)).to.be.equal(0);
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
          cometAddress: comet.address
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
        }
      ],
      534352: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44'
        }
      ]
    });
  },
});
