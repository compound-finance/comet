import { DeploymentManager } from "../../../../plugins/deployment_manager/DeploymentManager";
import {
  diffState,
  getCometConfig,
} from "../../../../plugins/deployment_manager/DiffState";
import { migration } from "../../../../plugins/deployment_manager/Migration";
import {
  calldata,
  exp,
  getConfigurationStruct,
  proposal,
} from "../../../../src/deploy";
import { expect } from "chai";

const SECONDS_PER_YEAR = 31_536_000n;
const ENSName = "compound-community-licenses.eth";
const ENSResolverAddress = "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41";
const ENSRegistryAddress = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const ENSSubdomainLabel = "v3-additional-grants";
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = "v3-official-markets";
const opCOMPAddress = "0x7e7d4467112689329f7E06571eD0E8CbAd4910eE";

export default migration("1707399040_configurate_and_ens", {
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

    const cometFactory = await deploymentManager.fromDep(
      "cometFactory",
      "optimism",
      "usdc"
    );
    const {
      bridgeReceiver,
      timelock: localTimelock,
      comet,
      cometAdmin,
      configurator,
      rewards,
    } = await deploymentManager.getContracts();

    const {
      opL1CrossDomainMessenger,
      opL1StandardBridge,
      governor,
      comptrollerV2,
      COMP: mainnetCOMP,
      USDT: mainnetUSDT,
      CCTPTokenMessenger,
    } = await govDeploymentManager.getContracts();

    // CCTP destination domain for Optimism
    const OptimismDestinationDomain = 2;

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      "ENSResolver",
      ENSResolverAddress
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const opChainId = (
      await deploymentManager.hre.ethers.provider.getNetwork()
    ).chainId.toString();
    const newMarketObject = { baseSymbol: "USDT", cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(
      await ENSResolver.text(subdomainHash, ENSTextRecordKey)
    );
    if (officialMarketsJSON[opChainId]) {
      officialMarketsJSON[opChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[opChainId] = [newMarketObject];
    }

    const configuration = await getConfigurationStruct(deploymentManager);
    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(
        comet.address,
        cometFactory.address
      )
    );
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
      [comet.address, opCOMPAddress]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]", "string[]", "bytes[]"],
      [
        [
          configurator.address,
          configurator.address,
          cometAdmin.address,
          rewards.address,
        ],
        [0, 0, 0, 0],
        [
          "setFactory(address,address)",
          "setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))",
          "deployAndUpgradeTo(address,address)",
          "setRewardConfig(address,address)",
        ],
        [
          setFactoryCalldata,
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata,
        ],
      ]
    );

    const USDTAmountToBridge = exp(10_000, 6);

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet, set Reward Config on Optimism
      {
        contract: opL1CrossDomainMessenger,
        signature: "sendMessage(address,bytes,uint32)",
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000],
      },
      // 2. Approve USDT to CCTP
      {
        contract: mainnetUSDT,
        signature: "approve(address,uint256)",
        args: [CCTPTokenMessenger.address, USDTAmountToBridge],
      },
      // 3. Burn USDT to Optimism via CCTP
      {
        contract: CCTPTokenMessenger,
        signature: "depositForBurn(uint256,uint32,bytes32,address)",
        args: [
          USDTAmountToBridge,
          OptimismDestinationDomain,
          utils.hexZeroPad(comet.address, 32),
          mainnetUSDT.address,
        ],
      },
      // 4. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: "setText(bytes32,string,string)",
        calldata: ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "string", "string"],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },
    ];

    const description = "# Initialize cUSDTv3 on Optimism\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes deployment of Compound III to Optimism network. This proposal takes the governance steps recommended and necessary to initialize a Compound III USDT market on Optimism; upon execution, cUSDTv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/deploy-compound-iii-on-optimism/4975/6).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/833) and [forum discussion](https://www.comp.xyz/t/deploy-compound-iii-on-optimism/4975).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Optimism. This sends the encoded `setConfiguration` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Optimism. It also calls `setRewardConfig` on the Optimism rewards contract, to establish Optimism’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 5 COMP/day and borrow speed to be 5 COMP/day.\n\nThe second action approves Circle’s Cross-Chain Transfer Protocol (CCTP) [TokenMessenger](https://etherscan.io/address/0xbd3fa81b58ba92a82136038b25adec7066af3155) to take the Timelock's USDT on Mainnet, in order to seed the market reserves through the CCTP.\n\nThe third action deposits and burns 10K USDT from mainnet via depositForBurn function on CCTP’s TokenMessenger contract to mint native USDT to Comet on Optimism.\n\nThe fourth action approves Optimism’s [L1StandardBridge](https://etherscan.io/address/0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1) to take Timelock's COMP, in order to seed the rewards contract through the bridge.\n\nThe fifth action deposits 3.6K COMP from mainnet to the Optimism L1StandardBridge contract to bridge to CometRewards.\n\nThe sixth action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Optimism cUSDTv3 market";
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find((event) => event.event === "ProposalCreated");
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
    await deploymentManager.spider();

    const { comet, rewards, COMP, USDT } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(
      comet,
      getCometConfig,
      preMigrationBlockNumber
    );
    expect(stateChanges).to.deep.equal({
      storeFrontPriceFactor: exp(0.6, 18),
      baseTrackingSupplySpeed: exp(5 / 86400, 15, 18),
      baseTrackingBorrowSpeed: exp(5 / 86400, 15, 18),
      borrowPerSecondInterestRateSlopeLow: exp(0.061, 18) / SECONDS_PER_YEAR,
      borrowPerSecondInterestRateSlopeHigh: exp(3.2, 18) / SECONDS_PER_YEAR,
      supplyPerSecondInterestRateSlopeLow: exp(0.059, 18) / SECONDS_PER_YEAR,
      supplyPerSecondInterestRateSlopeHigh: exp(2.9, 18) / SECONDS_PER_YEAR,
      WETH: {
        supplyCap: exp(1600, 18),
      },
      OP: {
        supplyCap: exp(400000, 18),
      },
      WBTC: {
        supplyCap: exp(60, 8),
      },
      wstETH: {
        supplyCap: exp(300, 18),
      },
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3.
    expect(await USDT.balanceOf(comet.address)).to.be.equal(exp(10_000, 6));

    // 4.
    const ENSResolver = await govDeploymentManager.existing(
      "ENSResolver",
      ENSResolverAddress
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(
      subdomainHash,
      ENSTextRecordKey
    );
    const officialMarkets = JSON.parse(officialMarketsJSON);

    expect(officialMarkets).to.deep.equal({
      /// parse and update before migration
      1: [
        {
          baseSymbol: "USDC",
          cometAddress: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
        },
        {
          baseSymbol: "WETH",
          cometAddress: "0xA17581A9E3356d9A858b789D68B4d866e593aE94",
        },
      ],
      137: [
        {
          baseSymbol: "USDC",
          cometAddress: "0xF25212E676D1F7F89Cd72fFEe66158f541246445",
        },
      ],
      8453: [
        {
          baseSymbol: "USDbC",
          cometAddress: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf",
        },
        {
          baseSymbol: "WETH",
          cometAddress: "0x46e6b214b524310239732D51387075E0e70970bf",
        },
      ],
      42161: [
        {
          baseSymbol: "USDC.e",
          cometAddress: "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA",
        },
        {
          baseSymbol: "USDC",
          cometAddress: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf",
        },
      ],
      10: [
        {
          baseSymbol: "USDC",
          cometAddress: "push address of USDC comet here"//cometUSDC.address,
        },
        {
          baseSymbol: "USDT",
          cometAddress: comet.address,
        },
      ],
    });
  },
});
