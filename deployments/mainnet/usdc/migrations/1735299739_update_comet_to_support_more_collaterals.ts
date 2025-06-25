import { expect } from "chai";
import { DeploymentManager } from "../../../../plugins/deployment_manager/DeploymentManager";
import { migration } from "../../../../plugins/deployment_manager/Migration";
import { proposal } from "../../../../src/deploy";
import { ethers, Contract } from "ethers";
import { Interface } from "ethers/lib/utils";
import { Tenderly, Network } from "@tenderly/sdk";

const USDS_COMET = "0x5D409e56D886231aDAf00c8775665AD0f9897b56";
const USDS_EXT = "0x95DeDD64b551F05E9f59a101a519B024b6b116E7";

const USDT_COMET = "0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840";
const USDT_EXT = "0x5C58d4479A1E9b2d19EE052143FA73F0ee79A36e";

let newCometExtAddressUSDC!: string;
let newCometExtAddressUSDS!: string;
let newCometExtAddressUSDT!: string;

export default migration(
  "1735299739_update_comet_to_support_more_collaterals",
  {
    async prepare(dm: DeploymentManager) {
      const assetListFactory = await dm.deploy(
        "assetListFactory",
        "AssetListFactory.sol",
        []
      );

      const cometFactoryWithExtendedAssetList = await dm.deploy(
        "cometFactoryWithExtendedAssetList",
        "CometFactoryWithExtendedAssetList.sol",
        []
      );
      const { comet } = await dm.getContracts();
      const extUSDC = new Contract(
        await comet.extensionDelegate(),
        [
          "function name() view returns (string)",
          "function symbol() view returns (string)",
        ],
        await dm.getSigner()
      );
      const newCometExtUSDC = await dm.deploy(
        "CometExtAssetList",
        "CometExtAssetList.sol",
        [
          {
            name32: ethers.utils.formatBytes32String(await extUSDC.name()),
            symbol32: ethers.utils.formatBytes32String(await extUSDC.symbol()),
          },
          assetListFactory.address,
        ],
        true
      );
      const extUSDS = new Contract(
        USDS_EXT,
        [
          "function name() view returns (string)",
          "function symbol() view returns (string)",
        ],
        await dm.getSigner()
      );
      const newCometExtUSDS = await dm.deploy(
        "CometExtAssetList",
        "CometExtAssetList.sol",
        [
          {
            name32: ethers.utils.formatBytes32String(await extUSDS.name()),
            symbol32: ethers.utils.formatBytes32String(await extUSDS.symbol()),
          },
          assetListFactory.address,
        ],
        true
      );
      const extUSDT = new Contract(
        USDT_EXT,
        [
          "function name() view returns (string)",
          "function symbol() view returns (string)",
        ],
        await dm.getSigner()
      );
      const newCometExtUSDT = await dm.deploy(
        "CometExtAssetList",
        "CometExtAssetList.sol",
        [
          {
            name32: ethers.utils.formatBytes32String(await extUSDT.name()),
            symbol32: ethers.utils.formatBytes32String(await extUSDT.symbol()),
          },
          assetListFactory.address,
        ],
        true
      );

      return {
        cometFactoryWithExtendedAssetList:
          cometFactoryWithExtendedAssetList.address,
        newCometExtUSDC: newCometExtUSDC.address,
        newCometExtUSDS: newCometExtUSDS.address,
        newCometExtUSDT: newCometExtUSDT.address,
      };
    },

    async enact(
      dm: DeploymentManager,
      _,
      {
        cometFactoryWithExtendedAssetList,
        newCometExtUSDC,
        newCometExtUSDS,
        newCometExtUSDT,
      },
      tenderly = false
    ) {
      const { hre } = dm;
      const {
        governor,
        comet,
        cometAdmin,
        configurator,
      } = await dm.getContracts();
      const signer = await dm.getSigner();
      const fromAddr = await signer.getAddress();

      

      newCometExtAddressUSDC = newCometExtUSDC;
      newCometExtAddressUSDS = newCometExtUSDS;
      newCometExtAddressUSDT = newCometExtUSDT;

      const actions = [
        {
          contract: configurator,
          signature: "setFactory(address,address)",
          args: [comet.address, cometFactoryWithExtendedAssetList],
        },
        {
          contract: configurator,
          signature: "setFactory(address,address)",
          args: [USDS_COMET, cometFactoryWithExtendedAssetList],
        },
        {
          contract: configurator,
          signature: "setFactory(address,address)",
          args: [USDT_COMET, cometFactoryWithExtendedAssetList],
        },

        {
          contract: configurator,
          signature: "setExtensionDelegate(address,address)",
          args: [comet.address, newCometExtUSDC],
        },
        {
          contract: configurator,
          signature: "setExtensionDelegate(address,address)",
          args: [USDS_COMET, newCometExtUSDS],
        },
        {
          contract: configurator,
          signature: "setExtensionDelegate(address,address)",
          args: [USDT_COMET, newCometExtUSDT],
        },

        {
          contract: cometAdmin,
          signature: "deployAndUpgradeTo(address,address)",
          args: [configurator.address, comet.address],
        },
        {
          contract: cometAdmin,
          signature: "deployAndUpgradeTo(address,address)",
          args: [configurator.address, USDS_COMET],
        },
        {
          contract: cometAdmin,
          signature: "deployAndUpgradeTo(address,address)",
          args: [configurator.address, USDT_COMET],
        },
      ];

      const desc = "Update USDC, USDS, USDT Comets to support 24 collaterals";
      const trace = dm.tracer();

      if (tenderly) {
        const [targets, values, calldatas, description] = await proposal(
          actions,
          desc
        );

        const govIf = new Interface(governor.interface.fragments);
        const signer = await dm.getSigner();
        const fromAddr = await signer.getAddress();

        const proposeData = govIf.encodeFunctionData("propose", [
          targets,
          values,
          calldatas,
          description,
        ]);

        const bundle = [
          {
            from: fromAddr,
            to: governor.address,
            gas: "0x0",
            value: "0x0",
            data: proposeData,
          },
        ];

        const sim = await hre.ethers.provider.send("tenderly_simulateBundle", [
          bundle,
          "latest",
        ]);

        console.dir(sim, { depth: null });

      }

      const tx = await dm.retry(async () => {
        return await trace(
          governor.propose(...(await proposal(actions, desc)))
        );
      });
      trace(
        `Created proposal ${
          tx.events.find((e) => e.event === "ProposalCreated").args[0]
        }`
      );
    },

    async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
      return false;
    },

    async verify(dm: DeploymentManager) {
      const { comet } = await dm.getContracts();
      const signer = await dm.getSigner();

      async function check(cometAddr: string, expectExt: string) {
        const inst = new Contract(
          cometAddr,
          [
            "function assetList() view returns (address)",
            "function extensionDelegate() view returns (address)",
          ],
          signer
        );
        expect(await inst.assetList()).to.not.equal(
          ethers.constants.AddressZero
        );
        expect(await inst.extensionDelegate()).to.equal(expectExt);
      }

      await check(comet.address, newCometExtAddressUSDC);
      await check(USDS_COMET, newCometExtAddressUSDS);
      await check(USDT_COMET, newCometExtAddressUSDT);
    },
  }
);
