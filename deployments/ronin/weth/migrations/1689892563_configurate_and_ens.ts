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

const destinationChainSelector = '6916147374840168594';
const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const ETHAmountToBridge = exp(25, 18);

export default migration('1689892563_configurate_and_ens', {
  prepare: async () => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const { bridgeReceiver, comet, cometAdmin, configurator, rewards } =
      await deploymentManager.getContracts();


    const {
      l1CCIPRouter,
      roninl1NativeBridge,
      governor,
    } = await govDeploymentManager.getContracts();


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

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
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
      baseSymbol: 'WETH',
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

    // Add WBTC market into ENS
    if (!officialMarketsJSON['1'].find((market => market.baseSymbol === 'WBTC'))) {
      officialMarketsJSON['1'].push({
        baseSymbol: 'WBTC',
        cometAddress: '0xe85Dc543813B8c2CFEaAc371517b925a166a9293',
      });
    }

    if (!officialMarketsJSON['130']?.find((market => market.baseSymbol === 'USDC'))) {
      officialMarketsJSON['1'].push({
        baseSymbol: 'USDC',
        cometAddress: '0x2c7118c4C88B9841FCF839074c26Ae8f035f2921',
      });
    }

    const fee = await l1CCIPRouter.getFee(destinationChainSelector, [
      utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
      l2ProposalData,
      [],
      ethers.constants.AddressZero,
      '0x'
    ]);

    const actions = [
      {
        contract: roninl1NativeBridge,
        signature: 'requestDepositFor((address,address,(uint8,uint256,uint256)))',
        args: [
          [
            comet.address,
            ethers.constants.AddressZero,
            [0, 0, ETHAmountToBridge],
          ]
        ],
        value: ETHAmountToBridge
      },
      {
        contract: l1CCIPRouter,
        signature: 'ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))',
        args:
          [
            destinationChainSelector,
            [
              utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
              l2ProposalData,
              [],
              ethers.constants.AddressZero,
              '0x'
            ]
          ],
        value: fee
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


    const description = '# Initialize cWETHv3 on Ronin\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes deployment of Compound III to Ronin network. This proposal takes the governance steps recommended and necessary to initialize a Compound III WETH market on Ronin; upon execution, cWETHv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite] (https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/deploy-compound-iii-on-ronin/6128/8).\n\nFurther detailed information can be found on the corresponding [deployment pull request](https://github.com/woof-software/comet/pull/123), [deploy market GitHub action run](https://github.com/woof-software/comet/actions/runs/13839778262) and [forum discussion](https://www.comp.xyz/t/deploy-compound-iii-on-ronin/6128).\n\n\n## Rewards\n\nGauntlet provided recommendations for COMP rewards, however, the COMP token is not whitelisted on CCIP. When the COMP token is whitelisted, we will create a proposal to bridge COMP tokens and set up speeds.\n\n## Proposal Actions\n\nThe first proposal action bridges ETH seed reserves to the comet using [roninl1NativeBridge](https://etherscan.io/address/0x64192819Ac13Ef72bF6b5AE239AC672B43a9AF08). Bridged ETH will be converted to WETH automatically.\n\nThe second proposal action sets the Comet configuration and deploys a new Comet implementation on Ronin. This sends the encoded `setConfiguration` and `deployAndUpgradeTo` calls across the [l1CCIPRouter](https://etherscan.io/address/0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D) to the bridge receiver on Ronin. \n\nThe third action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Ronin cWETHv3 market.';

    const txn = await governor.propose(...(await proposal(actions, description)));
    const event = (await txn.wait()).events.find((event) => event.event === 'ProposalCreated');

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
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;
    await deploymentManager.spider();
    const { comet, rewards, WETH } = await deploymentManager.getContracts();

    const hreMainnet = await forkedHreForBase({ name: '', network: 'mainnet', deployment: '' });
    const dm = new DeploymentManager('mainnet', 'usdc', hreMainnet);

    const cometMainnet = await dm.contract('comet');
    const { timelock } = await govDeploymentManager.getContracts();
    const guardian = await cometMainnet!.pauseGuardian();

    const pauseGuardian = new ethers.Contract(
      await comet.pauseGuardian(),
      [
        'function getOwners() external view returns (address[] memory)',
      ],
      await deploymentManager.getSigner()
    );

    const GnosisSafeContract = new ethers.Contract(
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

    const cometNew = new ethers.Contract(
      comet.address,
      [
        'function assetList() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );


    const assetListAddress = await cometNew.assetList();

    expect(assetListAddress).to.not.be.equal(ethers.constants.AddressZero);

    const stateChanges = await diffState(
      comet,
      getCometConfig,
      preMigrationBlockNumber
    );
    expect(stateChanges).to.deep.equal({
      WRON: {
        supplyCap: exp(3000000, 18)
      },
      USDC: {
        supplyCap: exp(400000, 6)
      },
      AXS: {
        supplyCap: exp(300000, 18)
      },
      // baseTrackingSupplySpeed: exp(2/86400, 15, 18),
      // baseTrackingBorrowSpeed: exp(1/86400, 15, 18),
    });

    // We should not do this check, as rewards only deployed, but without reward token
    // const config = await rewards.rewardConfig(comet.address);
    // expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    // expect(config.shouldUpscale).to.be.equal(true);

    // 4. & 5.
    expect(await WETH.balanceOf(comet.address)).to.be.equal(exp(25, 18));
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
          cometAddress: comet.address,
        },
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
