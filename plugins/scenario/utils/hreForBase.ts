import type { ethers } from 'ethers';
import type { HardhatEthersHelpers } from '@nomiclabs/hardhat-ethers/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { HardhatContext } from 'hardhat/internal/context';
import { loadConfigAndTasks } from 'hardhat/internal/core/config/config-loading';
import { getEnvHardhatArguments } from 'hardhat/internal/core/params/env-variables';
import { HARDHAT_PARAM_DEFINITIONS } from 'hardhat/internal/core/params/hardhat-params';
import { Environment } from 'hardhat/internal/core/runtime-environment';
import { ForkSpec } from '../World';
import { HttpNetworkUserConfig } from 'hardhat/types';
import { EthereumProvider } from 'hardhat/types/provider';

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
change network extension: https://github.com/dmihal/hardhat-change-network/blob/master/src/type-extensions.ts
*/
declare module 'hardhat/internal/core/runtime-environment' {
  interface Environment {
    waffle: any;
    ethers: typeof ethers & HardhatEthersHelpers;
    changeNetwork(newNetwork: string): void;
    getProvider(newNetwork: string): EthereumProvider;
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
    ctx.tasksDSL.getScopesDefinitions(),
    ctx.environmentExtenders,
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
    ctx.tasksDSL.getScopesDefinitions(),
    ctx.environmentExtenders,
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
