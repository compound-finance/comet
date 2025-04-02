import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import {
  diffState,
  getCometConfig,
} from '../../../../plugins/deployment_manager/DiffState';
import {
  calldata,
  exp,
  getConfigurationStruct,
  proposal,
} from '../../../../src/deploy';
import { expect } from 'chai';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';
import { utils, constants, Contract } from 'ethers';

const destinationChainSelector = '6916147374840168594';
const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const ETHAmountToSwap = exp(26.12, 18);

const RONIN_SWAP_ROUTER = '0xC05AFC8c9353c1dd5f872EcCFaCD60fd5A2a9aC7';

let expectedWronAmount;

export default migration('1743594813_configurate_and_ens', {
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
      cometFactory,
      comet,
      cometAdmin,
      configurator,
      // rewards,
      WETH,
      WRON,
      timelock,
    } = await deploymentManager.getContracts();

    const {
      l1CCIPRouter,
      roninl1NativeBridge,
      governor,
    } = await govDeploymentManager.getContracts();

    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, cometFactory.address)
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

    const swapRouter = new Contract(
      RONIN_SWAP_ROUTER,
      [
        'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) external returns (uint256[])',
        'function getAmountsOut(uint256,address[]) external view returns (uint256[])',
      ],
      deploymentManager.hre.ethers.provider
    );

    const approveCalldata = await calldata(
      WETH.populateTransaction.approve(
        RONIN_SWAP_ROUTER,
        ETHAmountToSwap
      )
    );

    expectedWronAmount = (await swapRouter.getAmountsOut(
      ETHAmountToSwap,
      [WETH.address, WRON.address]
    ))[1];
    console.log('expectedWronAmount', expectedWronAmount);

    const currentBlock = await deploymentManager.hre.ethers.provider.getBlock('latest');
    const currentTimestamp = currentBlock.timestamp;
    const swapCalldata = await calldata(
      swapRouter.populateTransaction.swapExactTokensForTokens(
        ETHAmountToSwap,
        expectedWronAmount.sub(1),
        [WETH.address, WRON.address],
        comet.address,
        currentTimestamp + (86400 * 14) // 14 days
      )
    );
    console.log('Current timestamp\n\n\n', currentTimestamp);

    const l2ProposalDataPart1 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          WETH.address,
          swapRouter.address,
        ],
        [
          0,
          0,
        ],
        [
          'approve(address,uint256)',
          'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
        ],
        [
          approveCalldata,
          swapCalldata,
        ],
      ]
    );

    const l2ProposalDataPart2 = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          cometAdmin.address,
        ],
        [
          0, 0, 0, 
        ],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          setFactoryCalldata,
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
        ],
      ]
    );

    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = utils.namehash(ENSSubdomain);
    const chainId = 2020;
    const newMarketObject = {
      baseSymbol: 'WRON',
      cometAddress: comet.address,
    };
    const officialMarketsJSON = JSON.parse(
      await ENSResolver.text(subdomainHash, ENSTextRecordKey)
    );
    if (officialMarketsJSON[chainId]) {
      officialMarketsJSON[chainId].push(newMarketObject);
    } else {
      officialMarketsJSON[chainId] = [newMarketObject];
    }

    // Add WETH market into ENS
    if (!officialMarketsJSON['2020'].find((market => market.baseSymbol === 'WETH'))) {
      officialMarketsJSON['2020'].push({
        baseSymbol: 'WETH',
        cometAddress: '0x4006eD4097Ee51c09A04c3B0951D28CCf19e6DFE',
      });
    }


    const fee1 = await l1CCIPRouter.getFee(destinationChainSelector, [
      utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
      l2ProposalDataPart1,
      [],
      constants.AddressZero,
      '0x'
    ]);

    const fee2 = await l1CCIPRouter.getFee(destinationChainSelector, [
      utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
      l2ProposalDataPart2,
      [],
      constants.AddressZero,
      '0x'
    ]);

    const mainnetActions = [
      {
        contract: roninl1NativeBridge,
        signature: 'requestDepositFor((address,address,(uint8,uint256,uint256)))',
        args: [
          [
            timelock.address,
            constants.AddressZero,
            [0, 0, ETHAmountToSwap],
          ]
        ],
        value: ETHAmountToSwap
      },
      {
        contract: l1CCIPRouter,
        signature: 'ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))',
        args:
          [
            destinationChainSelector,
            [
              utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
              l2ProposalDataPart1,
              [],
              constants.AddressZero,
              '0x'
            ]
          ],
        value: fee1.mul(2n)
      },
      {
        contract: l1CCIPRouter,
        signature: 'ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))',
        args:
          [
            destinationChainSelector,
            [
              utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
              l2ProposalDataPart2,
              [],
              constants.AddressZero,
              '0x'
            ]
          ],
        value: fee2.mul(2n)
      },
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },
    ];


    const description = '# Initialize cWRONv3 on Ronin\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes deployment of Compound III to Ronin network. This proposal takes the governance steps recommended and necessary to initialize a Compound III WRON market on Ronin; upon execution, cWRONv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite] (https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/deploy-compound-iii-on-ronin/6128/8).\n\nFurther detailed information can be found on the corresponding [deployment pull request](https://github.com/woof-software/comet/pull/146), [deploy market GitHub action run](<>) and [forum discussion](https://www.comp.xyz/t/deploy-compound-iii-on-ronin/6128).\n\n\n## Rewards\n\nGauntlet provided recommendations for COMP rewards, however, the COMP token is not whitelisted on CCIP. When the COMP token is whitelisted, we will create a proposal to bridge COMP tokens and set up speeds.\n\n## Proposal Actions\n\nThe first proposal action bridges ETH using [roninl1NativeBridge](https://etherscan.io/address/0x64192819Ac13Ef72bF6b5AE239AC672B43a9AF08). Bridged ETH will be converted to WETH automatically and swapped for WRON in order to seed the reserves.\n\nThe second proposal actions approves and swaps received WETH for WRON via native Katana exchange [router](https://app.roninchain.com/address/0xc05afc8c9353c1dd5f872eccfacd60fd5a2a9ac7).\n\nThe third proposal action sets the Comet configuration and deploys a new Comet implementation on Ronin. This sends the encoded `setConfiguration` and `deployAndUpgradeTo` calls across the [l1CCIPRouter](https://etherscan.io/address/0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D) to the bridge receiver on Ronin. \n\nThe fourth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Ronin cWRONv3 market.';

    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    preMigrationBlockNumber: number
  ) {
    // const ethers = deploymentManager.hre.ethers;
    await deploymentManager.spider();
    const {
      comet,
      // rewards,
      WRON,
    } = await deploymentManager.getContracts();

    const hreMainnet = await forkedHreForBase({ name: '', network: 'mainnet', deployment: '' });
    const dm = new DeploymentManager('mainnet', 'usdc', hreMainnet);

    const { comet: cometMainnet } = await dm.getContracts();
    const { timelock } = await govDeploymentManager.getContracts();
    const guardian = await cometMainnet.pauseGuardian();

    const pauseGuardian = new Contract(
      await comet.pauseGuardian(),
      [
        'function getOwners() external view returns (address[] memory)',
      ],
      await deploymentManager.getSigner()
    );

    const GnosisSafeContract = new Contract(
      guardian,
      [
        'function getOwners() external view returns (address[] memory)',
      ],
      await govDeploymentManager.getSigner()
    );
    const ownersMainnet = await GnosisSafeContract.getOwners();

    const owners = await pauseGuardian.getOwners();
    expect(owners).to.deep.equal(ownersMainnet);
    expect(owners.length).to.not.be.equal(0);

    const cometNew = new Contract(
      comet.address,
      [
        'function assetList() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );


    const assetListAddress = await cometNew.assetList();

    expect(assetListAddress).to.not.be.equal(constants.AddressZero);

    // const stateChanges = await diffState(
    //   comet,
    //   getCometConfig,
    //   preMigrationBlockNumber
    // );
    // expect(stateChanges).to.deep.equal({
    // WETH: {
    //   supplyCap: exp(500, 18)
    // },
    // USDC: {
    //   supplyCap: exp(500_000, 6)
    // },
    // AXS: {
    //   supplyCap: exp(300_000, 18)
    // },
    // baseTrackingSupplySpeed: exp(2/86400, 15, 18),
    // baseTrackingBorrowSpeed: exp(1/86400, 15, 18),
    // });

    // We should not do this check, as rewards only deployed, but without reward token
    // const config = await rewards.rewardConfig(comet.address);
    // expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    // expect(config.shouldUpscale).to.be.equal(true);

    // 4. & 5.
    expect(await WRON.balanceOf(comet.address)).to.be.equal(expectedWronAmount);
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
          cometAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xA17581A9E3356d9A858b789D68B4d866e593aE94',
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840'
        },
        {
          baseSymbol: 'wstETH',
          cometAddress: '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3',
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
          cometAddress: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB',
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214',
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
        }
      ],
      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xaeB318360f27748Acb200CE616E389A6C9409a07',
        },
      ],
      2020: [
        {
          baseSymbol: 'WETH',
          cometAddress: '0x4006eD4097Ee51c09A04c3B0951D28CCf19e6DFE',
        },
        {
          baseSymbol: 'WRON',
          cometAddress: comet.address,
        }
      ],
      5000: [
        {
          baseSymbol: 'USDe',
          cometAddress: '0x606174f62cd968d8e684c645080fa694c1D7786E'
        },
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
          cometAddress: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
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
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486',
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07',
        },
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
          cometAddress: '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44',
        },
      ]
    });
  },
});
