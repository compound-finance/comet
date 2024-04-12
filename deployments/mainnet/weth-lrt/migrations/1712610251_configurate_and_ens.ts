import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import {
  diffState,
  getCometConfig,
} from "../../../../plugins/deployment_manager/DiffState";

import { expect } from 'chai';

const COMPAddress = '0xc00e94cb662c3520282e6f5717214004a7f26888';
const SECONDS_PER_YEAR = 31_536_000n;
const ENSName = "compound-community-licenses.eth";
const ENSResolverAddress = "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41";
const ENSSubdomainLabel = "v3-additional-grants";
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = "v3-official-markets";

export default migration('1712610251_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const comptrollerV2 = await deploymentManager.fromDep('comptrollerV2', 'mainnet', 'usdc');
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdc');
    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      rewards,
      WETH,
    } = await deploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      "ENSResolver",
      ENSResolverAddress
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const baseChainId = (
      await deploymentManager.hre.ethers.provider.getNetwork()
    ).chainId.toString();
    const newMarketObject = {
      baseSymbol: "WETH",
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

    const configuration = await getConfigurationStruct(deploymentManager);

    // No need in Set v2 cETH speeds to 0 as it is already 0
    const actions = [
      // 1. Set the factory in the Configurator
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, cometFactory.address],
      },

      // 2. Set the configuration in the Configurator
      {
        contract: configurator,
        signature: 'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
        args: [comet.address, configuration],
      },

      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },

      // 4. Set the rewards configuration to COMP
      {
        contract: rewards,
        signature: "setRewardConfig(address,address)",
        args: [comet.address, COMPAddress],
      },

      // 5. Wrap some ETH as WETH
      {
        contract: WETH,
        signature: "deposit()",
        args: [],
        value: 5000000000000000000n, // 500e18 - current balance
      },

      // 6. Send all Timelock's WETH to Comet to seed reserves
      {
        contract: WETH,
        signature: "transfer(address,uint256)",
        args: [comet.address, exp(5, 18)],
      },

      // 7. Transfer COMP
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args: [rewards.address, exp(600, 18)],
      },

      // 8. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: "setText(bytes32,string,string)",
        calldata: ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "string", "string"],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },
    ];

    const description = "# Initialize cWETH-LRTv3 on Ethereum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes deployment of Compound III to Ethereum network. This proposal takes the governance steps recommended and necessary to initialize a Compound III WETH-LRT market on Ethereum; upon execution, cWETH-LRTv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-market-ezeth-on-eth-mainnet/5062/4).\n\nFurther detailed information can be found on the corresponding [deployment pull request](https://github.com/compound-finance/comet/pull/TODO), [proposal pull request](https://github.com/compound-finance/comet/pull/TODO), [deploy market GitHub action run](TODO) and [forum discussion](https://www.comp.xyz/t/add-market-ezeth-on-eth-mainnet/5062).\n\n\n## Proposal Actions \n\nThe first action sets the CometFactory for the new Comet instance in the existing Configurator.\n\nThe second action configures the Comet instance in the Configurator.\n\nThe third action deploys an instance of the newly configured factory and upgrades the Comet instance to use that implementation.\n\nThe fourth action configures the existing rewards contract for the newly deployed Comet instance.\n\nThe fifth and sixth actions are to wrap 5 ETH from the Timelock, and transfer the 5 WETH to the new Comet instance, in order to seed reserves.\n\nThe seventh action is to transfer 600 an additional COMP to the v3 rewards contract, in order to refresh its supply.\n\nThe eight action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Ethereum cWETH-LRTv3 market.\n";
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number) {
    const ethers = deploymentManager.hre.ethers;
    await deploymentManager.spider();

    const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdc');
    const {
      timelock,
      comet,
      configurator,
      rewards,
      COMP,
      WETH,
    } = await deploymentManager.getContracts();

    // 1.
    expect(await configurator.factory(comet.address)).to.be.equal(cometFactory.address);

    console.log({cometAddress: comet.address})
    console.log({getCometConfig: await getCometConfig(comet)})
    console.log({getCometConfig2: await getCometConfig(comet, preMigrationBlockNumber)})
    // 2. & 3.
    const stateChanges = await diffState(
      comet,
      getCometConfig,
      preMigrationBlockNumber
    );

    // Should be checked when the contracts are deployed and new PR created, where supply cap and speed is setted
    // expect(stateChanges).to.deep.equal({
    //   baseTrackingSupplySpeed: exp(3 / 86400, 15, 18), // 34_722_222_222n
    //   ezETH: {
    //     supplyCap: exp(2800, 18),
    //   }
    // });

    expect(await comet.storeFrontPriceFactor()).to.be.equal(exp(0.6, 18));
    expect(await comet.supplyPerSecondInterestRateSlopeLow()).to.be.equal(exp(0.02, 18) / SECONDS_PER_YEAR);
    expect(await comet.supplyPerSecondInterestRateSlopeHigh()).to.be.equal(exp(1, 18) / SECONDS_PER_YEAR);
    expect(await comet.borrowPerSecondInterestRateSlopeLow()).to.be.equal(exp(0.0235, 18) / SECONDS_PER_YEAR);
    expect(await comet.borrowPerSecondInterestRateSlopeHigh()).to.be.equal( exp(1, 18) / SECONDS_PER_YEAR);

    expect(await comet.supplyKink()).to.be.equal(900000000000000000n); // 0.9e18
    expect(await comet.borrowKink()).to.be.equal(900000000000000000n); // 0.9e18

    // 4.
    const config = await rewards.rewardConfig(comet.address);
    expect(config.token.toLowerCase()).to.be.equal(COMPAddress);
    expect(config.rescaleFactor).to.be.equal(1000000000000n);
    expect(config.shouldUpscale).to.be.equal(true);

    // 5. & 6.
    expect(await WETH.balanceOf(timelock.address)).to.be.equal(0);
    expect(await WETH.balanceOf(comet.address)).to.be.equal(exp(5, 18));
    expect(await comet.getReserves()).to.be.equal(exp(5, 18));

    // 7.
    expect(await COMP.balanceOf(rewards.address)).to.be.greaterThan(exp(600, 18));

    // 8.
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
      1: [
        {
          baseSymbol: "USDC",
          cometAddress: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
        },
        {
          baseSymbol: "WETH",
          cometAddress: "0xA17581A9E3356d9A858b789D68B4d866e593aE94",
        },
        {
          baseSymbol: "WETH",
          cometAddress: comet.address,
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
        {
          baseSymbol: "USDC",
          cometAddress: "0xb125E6687d4313864e53df431d5425969c15Eb2F",
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
      534352: [
        {
          baseSymbol: "USDC",
          cometAddress: "0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44",
        },
      ],
      // uncomment when Optimisim proposal will be executed
      // https://compound.finance/governance/proposals/238
      // 10: [
      //   {
      //     baseSymbol: "USDC",
      //     cometAddress: "",
      //   },
      // ],
    });
  }
});
