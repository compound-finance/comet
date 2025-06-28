import { task } from "hardhat/config";
import {
  Migration,
  loadMigrations,
} from "../../plugins/deployment_manager/Migration";
import { writeEnacted } from "../../plugins/deployment_manager/Enacted";
import { HardhatRuntimeEnvironment, HardhatConfig } from "hardhat/types";
import {
  DeploymentManager,
  VerifyArgs,
} from "../../plugins/deployment_manager";
import { impersonateAddress } from "../../plugins/scenario/utils";
import axios from "axios";
import hreForBase from "../../plugins/scenario/utils/hreForBase";
import { deriveAccounts } from "../../hardhat.config";
import { tenderly } from "hardhat";
import { executeOpenProposal, tenderlySimulateProposal } from "../../scenario/utils";
import { IGovernorBravo } from "../../build/types";
import { getOpenProposals } from "../../scenario/constraints/ProposalConstraint";

function getDefaultDeployment(config: HardhatConfig, network: string): string {
  const base = config.scenario.bases.find(b => b.name == network);
  if (!base) {
    throw new Error(`No bases for ${network}`);
  }
  return base.deployment;
}

async function getForkEnv(
  env: HardhatRuntimeEnvironment,
  deployment: string
): Promise<HardhatRuntimeEnvironment> {
  const base = env.config.scenario.bases.find(
    (b) => b.network == env.network.name && b.deployment == deployment
  );
  if (!base) {
    throw new Error(`No fork spec for ${env.network.name}`);
  }
  return await hreForBase(base);
}

export async function createTenderlyVNet(
  username: string,
  project: string,
  accessKey: string,
  blockNumber = 0,
  parentId = "1"
) {
  const slug = `vnet-${Date.now().toString(36)}`;

  const body = {
    slug,
    display_name: slug,
    fork_config: { network_id: Number(parentId), blockNumber },
    virtual_network_config: { chain_config: { chain_id: +parentId } },
    sync_state_config: { enabled: false },
    explorer_page_config: {
      enabled: false,
      verification_visibility: "bytecode",
    },
  };
  const url = `https://api.tenderly.co/api/v1/account/${username}/project/${project}/vnets`;
  let resp;
  try {
    resp = await axios.post(url, body, {
      headers: { "X-Access-Key": accessKey },
    });
  } catch (e) {
    console.error("Tenderly error:", JSON.stringify(e.response?.data, null, 2));
    throw e;
  }

  const { data } = resp;
  const adminRpc = data.rpcs.find((r: any) => /admin/i.test(r.name))?.url;
  if (!adminRpc) throw new Error("VNet created but admin RPC not returned");
  return { id: data.id as string, rpc: adminRpc };
}

export async function getTenderlyEnv(
  hre: HardhatRuntimeEnvironment,
  parentNet = "mainnet"
) {
  const { username, project, accessKey } = hre.config.tenderly;

  const { id, rpc } = await createTenderlyVNet(username, project, accessKey);
  const MNEMONIC =
    "myth like woof scare over problem client lizard pioneer submit female collect";
  function parseKeys(env = "") {
    return env
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((k) => (k.startsWith("0x") ? k : `0x${k}`));
  }

  const envKeys = process.env.ETH_PK ? parseKeys(process.env.ETH_PK) : [];

  const freshWallet = hre.ethers.Wallet.createRandom();
  const freshPk = freshWallet.privateKey;

  const allPks = [...envKeys, freshPk];

  hre.config.networks[parentNet] = {
    url: rpc,
    chainId: hre.config.networks[parentNet].chainId,
    accounts: process.env.ETH_PK
      ? allPks
      : {
          mnemonic: MNEMONIC,
          initialIndex: 0,
          count: 10,
          path: "m/44'/60'/0'/0",
          passphrase: "",
        },
    gas: "auto",
    gasPrice: "auto",
    gasMultiplier: 1,
    timeout: 20_000,
    httpHeaders: {},
  };

  hre.network.name = parentNet;

  await hre.changeNetwork(parentNet);

  console.log(`Virtual TestNet ${id} -> ${rpc}`);
  return hre;
}

async function runMigration<T>(
  deploymentManager: DeploymentManager,
  govDeploymentManager: DeploymentManager,
  prepare: boolean,
  enact: boolean,
  migration: Migration<T>,
  overwrite: boolean,
  tenderly: boolean = false
) {
  let artifact: T = await deploymentManager.readArtifact(migration);
  if (prepare) {
    if (artifact && !overwrite) {
      throw new Error(
        "Artifact already exists for migration, please specify --overwrite to overwrite artifact."
      );
    }

    console.log("Running preparation step...");
    artifact = await migration.actions.prepare(
      deploymentManager,
      govDeploymentManager
    );
    console.log("Preparation artifact", artifact);
    let outputFile = await deploymentManager.storeArtifact(migration, artifact);
    if (deploymentManager.cache.writeCacheToDisk) {
      console.log(`Migration preparation artifact stored in ${outputFile}.`);
    } else {
      console.log(
        `Migration preparation artifact would have been stored in ${outputFile}, but not writing to disk in a simulation.`
      );
    }
  }

  if (enact) {
    console.log("Running enactment step with artifact...", artifact);
    await migration.actions.enact(
      deploymentManager,
      govDeploymentManager,
      artifact,
      tenderly,
    );

    const {
      governor,
      COMP,
    } = await deploymentManager.getContracts()

    if (tenderly) {
    //   const proposals = await getOpenProposals(govDeploymentManager, governor as any);   
      
    //   // const lastEvent = await governor.queryFilter(
    //   //   governor.filters.ProposalCreated(),
    //   //   -1
    //   // );

    //   // console.log(lastEvent);

    //   // await tenderlySimulateProposal(deploymentManager, governor, COMP, proposals[-1], (lastEvent[-1] as any).description);
    // }
    }

    console.log("Enactment complete");
  }
}

task("deploy", "Deploys market")
  .addFlag("simulate", "only simulates the blockchain effects")
  .addFlag("noDeploy", "skip the actual deploy step")
  .addFlag("noVerify", "do not verify any contracts")
  .addFlag("noVerifyImpl", "do not verify the impl contract")
  .addFlag("overwrite", "overwrites cache")
  .addParam("deployment", "The deployment to deploy")
  .setAction(
    async (
      { simulate, noDeploy, noVerify, noVerifyImpl, overwrite, deployment },
      env
    ) => {
      const maybeForkEnv = simulate ? await getForkEnv(env, deployment) : env;
      const network = env.network.name;
      const tag = `${network}/${deployment}`;
      const dm = new DeploymentManager(network, deployment, maybeForkEnv, {
        writeCacheToDisk: !simulate || overwrite, // Don't write to disk when simulating, unless overwrite is set
        verificationStrategy: simulate ? "lazy" : "eager",
      });

      if (noDeploy) {
        // Don't run the deploy script
      } else {
        try {
          const overrides = undefined; // TODO: pass through cli args
          const delta = await dm.runDeployScript(
            overrides ?? { allMissing: true }
          );
          console.log(
            `[${tag}] Deployed ${dm.counter} contracts, spent ${dm.spent} Ξ`
          );
          console.log(`[${tag}]\n${dm.diffDelta(delta)}`);
        } catch (e) {
          console.log(`[${tag}] Failed to deploy with error: ${e}`);
        }
      }

      const verify = noVerify ? false : !simulate;
      const desc = verify ? "Verify" : "Would verify";
      if (noVerify && simulate) {
        // Don't even print if --no-verify is set with --simulate
      } else {
        await dm.verifyContracts(async (address, args) => {
          if (args.via === "buildfile") {
            const { contract: _, ...rest } = args;
            console.log(`[${tag}] ${desc} ${address}:`, rest);
          } else {
            console.log(`[${tag}] ${desc} ${address}:`, args);
          }
          return verify;
        });

        if (noVerifyImpl) {
          // Don't even try if --no-verify-impl
        } else {
          // Maybe verify the comet impl too
          const comet = await dm.contract("comet");
          const cometImpl = await dm.contract("comet:implementation");
          const configurator = await dm.contract("configurator");
          const config = await configurator.getConfiguration(comet.address);
          const args: VerifyArgs = {
            via: "artifacts",
            address: cometImpl.address,
            constructorArguments: [config],
          };
          console.log(`[${tag}] ${desc} ${cometImpl.address}:`, args);
          if (verify) {
            await dm.verifyContract(args);
          }
        }
      }
    }
  );

task("publish", "Verifies a known contract at an address, given its args")
  .addParam("address", "The address to publish")
  .addParam("deployment", "The deployment to use to verify", "")
  .addVariadicPositionalParam("constructorArguments", "The contract args", [])
  .setAction(async ({ address, constructorArguments, deployment }, env) => {
    const network = env.network.name;
    const deployment_ = deployment || getDefaultDeployment(env.config, network);
    const tag = `${network}/${deployment_}`;
    const dm = new DeploymentManager(network, deployment_, env);
    const args: VerifyArgs = {
      via: "artifacts",
      address,
      constructorArguments,
    };
    console.log(`[${tag} ${address}:`, args);
    await dm.verifyContract(args);
  });

task("gen:migration", "Generates a new migration")
  .addPositionalParam("name", "name of the migration")
  .addParam("deployment", "The deployment to generate the migration for")
  .setAction(async ({ name, deployment }, env) => {
    const network = env.network.name;
    const dm = new DeploymentManager(network, deployment, env, {
      writeCacheToDisk: true,
      verificationStrategy: "lazy",
    });
    const file = await dm.generateMigration(name);
    console.log(`Generated migration ${network}/${deployment}/${file}`);
  });

task("migrate", "Runs migration")
  .addPositionalParam("migration", "name of migration")
  .addOptionalParam(
    "impersonate",
    "the governor will impersonate the passed account for proposals [only when simulating]"
  )
  .addParam("deployment", "The deployment to apply the migration to")
  .addFlag(
    "prepare",
    "runs preparation [defaults to true if enact not specified]"
  )
  .addFlag("enact", "enacts migration [implies prepare]")
  .addFlag("noEnacted", "do not write enacted to the migration script")
  .addFlag("simulate", "only simulates the blockchain effects")
  .addFlag("tenderly", "use tenderly to simulate the migration")
  .addFlag("overwrite", "overwrites artifact if exists, fails otherwise")
  .setAction(
    async (
      {
        migration: migrationName,
        prepare,
        enact,
        noEnacted,
        simulate,
        tenderly,
        overwrite,
        deployment,
        impersonate,
      },
      env
    ) => {
      const origNetwork = env.network.name;

      let maybeForkEnv = simulate ? await getForkEnv(env, deployment) : env;
      if (tenderly) {
        maybeForkEnv = await getTenderlyEnv(env, origNetwork);
      }

      const network = origNetwork;
      const dm = new DeploymentManager(
        maybeForkEnv.network.name,
        deployment,
        maybeForkEnv,
        {
          writeCacheToDisk: !simulate || overwrite, // Don't write to disk when simulating, unless overwrite is set
          verificationStrategy: "eager", // We use eager here to verify contracts right after they are deployed
        },
        tenderly
      );
      await dm.spider();

      let governanceDm: DeploymentManager;

      const base = env.config.scenario.bases.find(
        (b) => b.network === network && b.deployment === deployment
      );
      const isBridgedDeployment = base.auxiliaryBase !== undefined;
      const governanceBase = isBridgedDeployment
        ? env.config.scenario.bases.find((b) => b.name === base.auxiliaryBase)
        : undefined;

      if (governanceBase) {
        const governanceEnv = await hreForBase(governanceBase, simulate);
        governanceDm = new DeploymentManager(
          governanceBase.network,
          governanceBase.deployment,
          governanceEnv,
          {
            writeCacheToDisk: !simulate || overwrite, // Don't write to disk when simulating, unless overwrite is set
            verificationStrategy: "eager", // We use eager here to verify contracts right after they are deployed
          }
        );
        await governanceDm.spider();
      } else {
        governanceDm = dm;
      }

      if (impersonate && !simulate) {
        throw new Error(
          "Cannot impersonate an address if not simulating a migration. Please specify --simulate to simulate."
        );
      } else if (impersonate && simulate && !tenderly) {
        const signer = await impersonateAddress(
          governanceDm,
          impersonate,
          10n ** 18n
        );
        governanceDm._signers.unshift(signer);
      }

      if (simulate) {
        console.log("Simulating migration without verification");
        dm.setVerificationStrategy("lazy");
        governanceDm.setVerificationStrategy("lazy");
      }

      const migrationPath = `${__dirname}/../../deployments/${network}/${deployment}/migrations/${migrationName}.ts`;
      const [migration] = await loadMigrations([migrationPath]);
      if (!migration) {
        throw new Error(
          `Unknown migration for network ${network}/${deployment}: \`${migrationName}\`.`
        );
      }
      if (!prepare && !enact) {
        prepare = true;
      }

      await runMigration(
        dm,
        governanceDm,
        prepare,
        enact,
        migration,
        overwrite,
        tenderly
      );

      if (enact && !noEnacted) {
        await writeEnacted(migration, dm, true);
      }
    }
  );

task("deploy_and_migrate", "Runs deploy and migration")
  .addPositionalParam("migration", "name of migration")
  .addOptionalParam(
    "impersonate",
    "the governor will impersonate the passed account for proposals [only when simulating]"
  )
  .addFlag("simulate", "only simulates the blockchain effects")
  .addFlag("noDeploy", "skip the actual deploy step")
  .addFlag("noVerify", "do not verify any contracts")
  .addFlag("noVerifyImpl", "do not verify the impl contract")
  .addFlag("overwrite", "overwrites cache")
  .addFlag(
    "prepare",
    "runs preparation [defaults to true if enact not specified]"
  )
  .addFlag("enact", "enacts migration [implies prepare]")
  .addFlag("noEnacted", "do not write enacted to the migration script")
  .addParam("deployment", "The deployment to deploy")
  .setAction(
    async (
      {
        migration: migrationName,
        prepare,
        enact,
        noEnacted,
        simulate,
        overwrite,
        deployment,
        impersonate,
        noDeploy,
        noVerify,
        noVerifyImpl,
      },
      env
    ) => {
      const maybeForkEnv = simulate ? await getForkEnv(env, deployment) : env;
      const network = env.network.name;
      const tag = `${network}/${deployment}`;
      const dm = new DeploymentManager(network, deployment, maybeForkEnv, {
        writeCacheToDisk: !simulate || overwrite, // Don't write to disk when simulating, unless overwrite is set
        verificationStrategy: simulate ? "lazy" : "eager",
      });

      if (noDeploy) {
        // Don't run the deploy script
      } else {
        try {
          const overrides = undefined; // TODO: pass through cli args
          const delta = await dm.runDeployScript(
            overrides ?? { allMissing: true }
          );
          console.log(
            `[${tag}] Deployed ${dm.counter} contracts, spent ${dm.spent} Ξ`
          );
          console.log(`[${tag}]\n${dm.diffDelta(delta)}`);
        } catch (e) {
          console.log(`[${tag}] Failed to deploy with error: ${e}`);
        }
      }

      const verify = noVerify ? false : !simulate;
      const desc = verify ? "Verify" : "Would verify";
      if (noVerify && simulate) {
        // Don't even print if --no-verify is set with --simulate
      } else {
        await dm.verifyContracts(async (address, args) => {
          if (args.via === "buildfile") {
            const { contract: _, ...rest } = args;
            console.log(`[${tag}] ${desc} ${address}:`, rest);
          } else {
            console.log(`[${tag}] ${desc} ${address}:`, args);
          }
          return verify;
        });

        if (noVerifyImpl) {
          // Don't even try if --no-verify-impl
        } else {
          // Maybe verify the comet impl too
          const comet = await dm.contract("comet");
          const cometImpl = await dm.contract("comet:implementation");
          const configurator = await dm.contract("configurator");
          const config = await configurator.getConfiguration(comet.address);
          const args: VerifyArgs = {
            via: "artifacts",
            address: cometImpl.address,
            constructorArguments: [config],
          };
          console.log(`[${tag}] ${desc} ${cometImpl.address}:`, args);
          if (verify) {
            await dm.verifyContract(args);
          }
        }
      }
      await dm.spider();

      let governanceDm: DeploymentManager;
      const base = env.config.scenario.bases.find(
        (b) => b.network === network && b.deployment === deployment
      );
      const isBridgedDeployment = base.auxiliaryBase !== undefined;
      const governanceBase = isBridgedDeployment
        ? env.config.scenario.bases.find((b) => b.name === base.auxiliaryBase)
        : undefined;

      if (governanceBase) {
        const governanceEnv = await hreForBase(governanceBase, simulate);
        governanceDm = new DeploymentManager(
          governanceBase.network,
          governanceBase.deployment,
          governanceEnv,
          {
            writeCacheToDisk: !simulate || overwrite, // Don't write to disk when simulating, unless overwrite is set
            verificationStrategy: "eager", // We use eager here to verify contracts right after they are deployed
          }
        );
        await governanceDm.spider();
      } else {
        governanceDm = dm;
      }

      if (impersonate && !simulate) {
        throw new Error(
          "Cannot impersonate an address if not simulating a migration. Please specify --simulate to simulate."
        );
      } else if (impersonate && simulate) {
        const signer = await impersonateAddress(
          governanceDm,
          impersonate,
          10n ** 18n
        );
        governanceDm._signers.unshift(signer);
      }

      const migrationPath = `${__dirname}/../../deployments/${network}/${deployment}/migrations/${migrationName}.ts`;
      const [migration] = await loadMigrations([migrationPath]);
      if (!migration) {
        throw new Error(
          `Unknown migration for network ${network}/${deployment}: \`${migrationName}\`.`
        );
      }
      if (!prepare && !enact) {
        prepare = true;
      }

      await runMigration(
        dm,
        governanceDm,
        prepare,
        enact,
        migration,
        overwrite
      );

      if (enact && !noEnacted) {
        await writeEnacted(migration, dm, true);
      }
    }
  );
