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
const roninSaigonCOMPAddress = "0x7e7d4467112689329f7E06571eD0E8CbAd4910eE";
const destinationChainSelector = "13116810400804392105";

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
      governor,
      //COMP: mainnetCOMP,
      USDC: mainnetUSDC,
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
      [comet.address, roninSaigonCOMPAddress]
    );
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]", "string[]", "bytes[]"],
      [
        // [configurator.address, cometAdmin.address, rewards.address],
        [configurator.address, cometAdmin.address],
        //[0, 0, 0],
        [0, 0],
        [
          "setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))",
          "deployAndUpgradeTo(address,address)",
          // "setRewardConfig(address,address)",
        ],
        [
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          //  setRewardConfigCalldata,
        ],
      ]
    );

    const COMPAmountToBridge = exp(3_600, 18);
    const USDCAmountToBridge = exp(10, 6);
    
    const actions = [
      // {
      //   contract: mainnetUSDC,
      //   signature: "approve(address,uint256)",
      //   args: [l1CCIPRouter.address, USDCAmountToBridge],
      // },
      // {
      //   contract: mainnetCOMP,
      //   signature: "approve(address,uint256)",
      //   args: [l1CCIPRouter.address, COMPAmountToBridge],
      // },
      {
        target: l1CCIPRouter.address,
        signature: "ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))",
        calldata: utils.defaultAbiCoder.encode(
          ["uint64", "tuple(bytes,bytes,tuple(address,uint256)[],address,bytes)"],
          [
            destinationChainSelector,
            [
              utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
              l2ProposalData,
              [],
              ethers.constants.AddressZero,
              "0x"
            ]
          ]
        ),
        value: utils.parseEther("0.1")
        // args: [
        //   destinationChainSelector,
        //   {
        //     receiver: utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
        //     data: l2ProposalData,
        //     tokenAmounts: [
        //       // {
        //       //   token: mainnetUSDC.address,
        //       //   amount: USDCAmountToBridge,
        //       // },
        //       // {
        //       //   token: mainnetCOMP.address,
        //       //   amount: COMPAmountToBridge,
        //       // },
        //     ],
        //     feeToken: ethers.constants.AddressZero,
        //     extraArgs: "0x",
        //   },
        // ],
        // value: utils.parseEther("0.1")
      },
    ];

    const description = "# Initialize cUSDCv3 on Ronin Saigon\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes deployment of Compound III to Optimism network. This proposal takes the governance steps recommended and necessary to initialize a Compound III USDC market on Optimism; upon execution, cUSDCv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/deploy-compound-iii-on-optimism/4975/6).\n\nFurther detailed information can be found on the corresponding [deployment pull request](https://github.com/compound-finance/comet/pull/838), [proposal pull request](https://github.com/compound-finance/comet/pull/842), [deploy market GitHub action run](https://github.com/dmitriy-bergman-works/comet-optimism/actions/runs/8581592608) and [forum discussion](https://www.comp.xyz/t/deploy-compound-iii-on-optimism/4975).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Optimism. This sends the encoded `setConfiguration` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Optimism. It also calls `setRewardConfig` on the Optimism rewards contract, to establish Optimism’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 5 COMP/day and borrow speed to be 5 COMP/day.\n\nThe second action approves Circle’s Cross-Chain Transfer Protocol (CCTP) [TokenMessenger](https://etherscan.io/address/0xbd3fa81b58ba92a82136038b25adec7066af3155) to take the Timelock's USDC on Mainnet, in order to seed the market reserves through the CCTP.\n\nThe third action deposits and burns 10K USDC from mainnet via depositForBurn function on CCTP’s TokenMessenger contract to mint native USDC to Comet on Optimism.\n\nThe fourth action approves Optimism’s [L1StandardBridge](https://etherscan.io/address/0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1) to take Timelock's COMP, in order to seed the rewards contract through the bridge.\n\nThe fifth action deposits 3.6K COMP from mainnet to the Optimism L1StandardBridge contract to bridge to CometRewards.\n\nThe sixth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Optimism cUSDCv3 market";

    const { timelock } = await govDeploymentManager.getContracts();
    // impersonate the timelock
    await govDeploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [timelock.address],
    });

    // const signer = await govDeploymentManager.hre.ethers.provider.getSigner(timelock.address);

    await govDeploymentManager.hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: [timelock.address, '0x56bc75e2d63100000'],
    });

    // const tx0 = await signer.sendTransaction({
    //   to: l1CCIPRouter.address,
    //   value: utils.parseEther("0.1"),
    //   data: "0x96f4e9f9"+actions[0].calldata.slice(2),
    // });

    // await tx0.wait();

    // console.log("0x96f4e9f9"+actions[0].calldata.slice(2));


    // console.log("approve USDC");
    // await mainnetUSDC.connect(signer).approve(l1CCIPRouter.address, USDCAmountToBridge);
    // console.log("ccipSend");
    // const tx = await l1CCIPRouter.connect(signer).ccipSend(
    //   destinationChainSelector,
    //   {
    //     receiver: utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
    //     data: l2ProposalData,
    //     tokenAmounts: [
    //       // {
    //       //   token: mainnetUSDC.address,
    //       //   amount: USDCAmountToBridge,
    //       // },
    //     ],
    //     feeToken: ethers.constants.AddressZero,
    //     extraArgs: "0x",
    //   },
    //   { value: utils.parseEther("0.1") }
    // );
    // await tx.wait();
    //console.log(await tx.wait());
    // console.log("ccipSend done");



    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find((event) => event.event === "ProposalCreated");
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
    // const ethers = deploymentManager.hre.ethers;
    // await deploymentManager.spider();

    // const { comet, rewards, COMP, USDC } =
    //   await deploymentManager.getContracts();

    // // 1.
    // const stateChanges = await diffState(
    //   comet,
    //   getCometConfig,
    //   preMigrationBlockNumber
    // );
    // expect(stateChanges).to.deep.equal({
    //   storeFrontPriceFactor: exp(0.6, 18),
    //   baseTrackingSupplySpeed: exp(5 / 86400, 15, 18),
    //   baseTrackingBorrowSpeed: exp(5 / 86400, 15, 18),
    //   borrowPerSecondInterestRateSlopeLow: exp(0.061, 18) / SECONDS_PER_YEAR,
    //   borrowPerSecondInterestRateSlopeHigh: exp(3.2, 18) / SECONDS_PER_YEAR,
    //   supplyPerSecondInterestRateSlopeLow: exp(0.059, 18) / SECONDS_PER_YEAR,
    //   supplyPerSecondInterestRateSlopeHigh: exp(2.9, 18) / SECONDS_PER_YEAR,
    //   WETH: {
    //     supplyCap: exp(1600, 18),
    //   },
    //   OP: {
    //     supplyCap: exp(700000, 18),
    //   },
    //   WBTC: {
    //     supplyCap: exp(60, 8),
    //   }
    // });

    // const config = await rewards.rewardConfig(comet.address);
    // expect(config.token).to.be.equal(COMP.address);
    // expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    // expect(config.shouldUpscale).to.be.equal(true);

    // // 2. & 3.
    // expect(await USDC.balanceOf(comet.address)).to.be.equal(exp(10_000, 6));

    // 4. & 5.
    // expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(3_600, 18));
  },
});
