import { DeploymentManager } from "../../../../plugins/deployment_manager/DeploymentManager";
import { migration } from "../../../../plugins/deployment_manager/Migration";
import {
  diffState,
  getCometConfig,
} from "../../../../plugins/deployment_manager/DiffState";
import {
  calldata,
  exp,
  getConfigurationStruct,
  proposal,
} from "../../../../src/deploy";
import { expect } from "chai";

const SECONDS_PER_YEAR = 31_536_000n;
const destinationChainSelector = "6916147374840168594";
const Comp = "0x514910771AF9Ca656af840dff83E8264EcF986CA";
const CompL2 = "0x3902228D6A3d2Dc44731fD9d45FeE6a61c722D0b";
const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const whale = '0xF977814e90dA44bFA03b6295A0616a897441aceC';

export default migration("1707394874_configurate_and_ens", {
  prepare: async (deploymentManager: DeploymentManager) => {
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
      COMP,
      timelock
    } = await govDeploymentManager.getContracts();


    const configuration = await getConfigurationStruct(deploymentManager);

    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(
        comet.address,
        configuration
      )
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ["address", "address"],
      [configurator.address, comet.address]
    );

    const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
      ["address", "address"],
      [comet.address, CompL2]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]", "string[]", "bytes[]"],
      [
        [configurator.address, cometAdmin.address, rewards.address],
        [0, 0, 0],
        [
          "setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))",
          "deployAndUpgradeTo(address,address)",
          "setRewardConfig(address,address)",
        ],
        [
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata,
        ],
      ]
    );

    const COMPAmountToBridge = exp(1, 18);
    const ETHAmountToBridge = exp(1, 18);

    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = utils.namehash(ENSSubdomain);
    const baseChainId = 2020;
    const newMarketObject = {
      baseSymbol: 'WETH',
      cometAddress: comet.address,
    };
    const officialMarketsJSON = JSON.parse(
      await ENSResolver.text(subdomainHash, ENSTextRecordKey)
    );
    if (officialMarketsJSON[baseChainId]) {
      officialMarketsJSON[baseChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[baseChainId] = [newMarketObject];
    }

    await govDeploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [whale],
    });
    const whaleSigner = await govDeploymentManager.getSigner(whale);

    const tx = await whaleSigner.sendTransaction({
      to: Comp,
      data: COMP.interface.encodeFunctionData('transfer', [timelock.address, COMPAmountToBridge]),
    });

    await tx.wait();

    const actions = [
      {
        target: Comp,
        signature: "approve(address,uint256)",
        calldata: utils.defaultAbiCoder.encode(
          ["address", "uint256"],
          [l1CCIPRouter.address, COMPAmountToBridge]
        ),
      },
      {
        contract: roninl1NativeBridge,
        signature: "requestDepositFor((address,address,(uint8,uint256,uint256)))",
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
        signature: "ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))",
        args:
          [
            destinationChainSelector,
            [
              utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
              l2ProposalData,
              [
                [
                  Comp,
                  COMPAmountToBridge
                ]
              ],
              ethers.constants.AddressZero,
              "0x"
            ]
          ],
        value: utils.parseEther("0.5")
      },
      // Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },
    ];

    console.log(bridgeReceiver.address);

    const description = "# Initialize cUSDCv3 on Ronin\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes deployment of Compound III to Optimism network. This proposal takes the governance steps recommended and necessary to initialize a Compound III USDC market on Optimism; upon execution, cUSDCv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/deploy-compound-iii-on-optimism/4975/6).\n\nFurther detailed information can be found on the corresponding [deployment pull request](https://github.com/compound-finance/comet/pull/838), [proposal pull request](https://github.com/compound-finance/comet/pull/842), [deploy market GitHub action run](https://github.com/dmitriy-bergman-works/comet-optimism/actions/runs/8581592608) and [forum discussion](https://www.comp.xyz/t/deploy-compound-iii-on-optimism/4975).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Optimism. This sends the encoded `setConfiguration` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Optimism. It also calls `setRewardConfig` on the Optimism rewards contract, to establish Optimism’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 5 COMP/day and borrow speed to be 5 COMP/day.\n\nThe second action approves Circle’s Cross-Chain Transfer Protocol (CCTP) [TokenMessenger](https://etherscan.io/address/0xbd3fa81b58ba92a82136038b25adec7066af3155) to take the Timelock's USDC on Mainnet, in order to seed the market reserves through the CCTP.\n\nThe third action deposits and burns 10K USDC from mainnet via depositForBurn function on CCTP’s TokenMessenger contract to mint native USDC to Comet on Optimism.\n\nThe fourth action approves Optimism’s [L1StandardBridge](https://etherscan.io/address/0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1) to take Timelock's COMP, in order to seed the rewards contract through the bridge.\n\nThe fifth action deposits 3.6K COMP from mainnet to the Optimism L1StandardBridge contract to bridge to CometRewards.\n\nThe sixth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Optimism cUSDCv3 market";

    await govDeploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [timelock.address],
    });

    await govDeploymentManager.hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: [timelock.address, '0x56bc75e2d63100000'],
    })

    const txn = await governor.propose(...(await proposal(actions, description)))
    const event = (await txn.wait()).events.find((event) => event.event === "ProposalCreated");

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return false;
  },

  async verify(
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    preMigrationBlockNumber: number
  ) {
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;
    await deploymentManager.spider();
    const {
      l1CCIPRouter, timelock
    } = await govDeploymentManager.getContracts();

    const { comet, rewards } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(
      comet,
      getCometConfig,
      preMigrationBlockNumber
    );
    // expect(stateChanges).to.deep.equal({
    //   WETH: {
    //     supplyCap: exp(2800, 18)
    //   },
    //   baseTrackingSupplySpeed: exp(4 / 86400, 15, 18), // 46296296296
    //   baseTrackingBorrowSpeed: exp(4 / 86400, 15, 18), // 46296296296
    // });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(CompL2);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 4. & 5.
    // expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(3_600, 18));

    // 6.
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = deploymentManager.hre.ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(
      subdomainHash,
      ENSTextRecordKey
    );
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
      5000: [
        {
          baseSymbol: 'USDe',
          cometAddress: "0x606174f62cd968d8e684c645080fa694c1D7786E"
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
      534352: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44',
        },
      ],
      2020: [
        {
          baseSymbol: 'WETH',
          cometAddress: comet.address,
        },
      ]
    });
  },
});
