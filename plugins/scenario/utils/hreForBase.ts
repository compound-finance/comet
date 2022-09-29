import type { ethers, Contract, providers, Signer } from 'ethers';
import type { HardhatEthersHelpers } from '@nomiclabs/hardhat-ethers/types';
import type {
  createFixtureLoader,
  link,
  loadFixture,
  MockContract,
  MockProvider,
  solidity,
} from 'ethereum-waffle';
import type { ContractJSON } from 'ethereum-waffle/dist/esm/ContractJSON';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { HardhatContext } from 'hardhat/internal/context';
import { loadConfigAndTasks } from 'hardhat/internal/core/config/config-loading';
import { getEnvHardhatArguments } from 'hardhat/internal/core/params/env-variables';
import { HARDHAT_PARAM_DEFINITIONS } from 'hardhat/internal/core/params/hardhat-params';
import { Environment } from 'hardhat/internal/core/runtime-environment';
import { ForkSpec } from '../World';
import { HttpNetworkUserConfig } from 'hardhat/types';

/*
mimics https://github.com/nomiclabs/hardhat/blob/master/packages/hardhat-core/src/internal/lib/hardhat-lib.ts

Hardhat's Environment class implements the HardhatRuntimeEnvironment interface.
However, the ethers and waffle plugins later extend the
HardhatRuntimeEnvironment interface. So if we want to interact with the
Environment class after the plugins have been loaded, we need to replicate the
alterations made to HardhatRuntimeEnvironment on the Environment interface.

These alterations will almost certainly go out-of-date as the ethers and waffle
packages are updated, and we'll need to do a similar alteration for any
additional packages that alter the HardhatRuntimeEnvironment interface.

ethers type extension: https://github.com/nomiclabs/hardhat/blob/master/packages/hardhat-ethers/src/internal/type-extensions.ts
waffle type extension: https://github.com/nomiclabs/hardhat/blob/master/packages/hardhat-waffle/src/type-extensions.ts
*/
declare module 'hardhat/internal/core/runtime-environment' {
  interface Environment {
    waffle: {
      provider: MockProvider;
      deployContract: (
        signer: Signer,
        contractJSON: ContractJSON,
        args?: any[],
        overrideOptions?: providers.TransactionRequest
      ) => Promise<Contract>;
      solidity: typeof solidity;
      link: typeof link;
      deployMockContract: (signer: Signer, abi: any[]) => Promise<MockContract>;
      createFixtureLoader: typeof createFixtureLoader;
      loadFixture: typeof loadFixture;
    };
    ethers: typeof ethers & HardhatEthersHelpers;
  }
}

export function nonForkedHreForBase(base: ForkSpec): HardhatRuntimeEnvironment {
  const ctx: HardhatContext = HardhatContext.getHardhatContext();

  const hardhatArguments = getEnvHardhatArguments(
    HARDHAT_PARAM_DEFINITIONS,
    process.env
  );

  const { resolvedConfig, userConfig } = loadConfigAndTasks(hardhatArguments);

  return new Environment(
    resolvedConfig,
    {
      ...hardhatArguments,
      ...{
        network: base.network
      }
    },
    ctx.tasksDSL.getTaskDefinitions(),
    ctx.extendersManager.getExtenders(),
    ctx.experimentalHardhatNetworkMessageTraceHooks,
    userConfig
  );
}

export function forkedHreForBase(base: ForkSpec): HardhatRuntimeEnvironment {
  const ctx: HardhatContext = HardhatContext.getHardhatContext();

  const hardhatArguments = getEnvHardhatArguments(HARDHAT_PARAM_DEFINITIONS, process.env);

  const { resolvedConfig: config, userConfig } = loadConfigAndTasks(hardhatArguments);

  const networks = config.networks;
  const { hardhat: defaultNetwork, localhost } = networks;

  const baseNetwork = networks[base.network] as HttpNetworkUserConfig;

  if (!baseNetwork) {
    throw new Error(`cannot find network config for network: ${base.network}`);
  }

  const forkedNetwork = {
    ...defaultNetwork,
    ...{
      forking: {
        enabled: true,
        url: baseNetwork.url,
        httpHeaders: {},
        ...(base.blockNumber && { blockNumber: base.blockNumber }),
      },
    },
    ...(baseNetwork.chainId ? { chainId: baseNetwork.chainId } : {}),
  };

  const forkedConfig = {
    ...config,
    ...{
      defaultNetwork: 'hardhat',
      networks: {
        hardhat: forkedNetwork,
        localhost
      },
    },
  };

  return new Environment(
    forkedConfig,
    hardhatArguments,
    ctx.tasksDSL.getTaskDefinitions(),
    ctx.extendersManager.getExtenders(),
    ctx.experimentalHardhatNetworkMessageTraceHooks,
    userConfig
  );
}

export default function hreForBase(base: ForkSpec, fork = true): HardhatRuntimeEnvironment {
  if (fork) {
    return forkedHreForBase(base);
  } else {
    return nonForkedHreForBase(base);
  }
}