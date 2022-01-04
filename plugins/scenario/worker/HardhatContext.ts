import { HardhatContext } from 'hardhat/internal/context';
export { HardhatContext } from 'hardhat/internal/context';
import { HardhatConfig } from 'hardhat/types/config';
export { HardhatConfig } from 'hardhat/types/config';
import { HardhatArguments } from 'hardhat/types/runtime';
export { HardhatArguments } from 'hardhat/types/runtime';
import { Environment } from 'hardhat/internal/core/runtime-environment';
import { getEnvHardhatArguments } from 'hardhat/internal/core/params/env-variables';
import { HARDHAT_PARAM_DEFINITIONS } from 'hardhat/internal/core/params/hardhat-params';

export type GlobalWithHardhatContext = typeof global & {
  __hardhatContext: HardhatContext;
};

export function createContext(config: HardhatConfig, hardhatArguments: HardhatArguments) {
  // TODO: I'm not sure this is ideal, inspired by these lines:
  // https://github.com/nomiclabs/hardhat/blob/4f108b51fc7f87bcf7f173a4301b5973918b4903/packages/hardhat-core/src/internal/context.ts#L13-L40
  let ctx = HardhatContext.createHardhatContext();

  let env = new Environment(
    config,
    hardhatArguments,
    ctx.tasksDSL.getTaskDefinitions(),
    ctx.extendersManager.getExtenders(),
    ctx.experimentalHardhatNetworkMessageTraceHooks
  );

  ctx.setHardhatRuntimeEnvironment(env);

  return ((global as GlobalWithHardhatContext).__hardhatContext = ctx);
}

export function getContext(): HardhatContext {
  return (global as GlobalWithHardhatContext).__hardhatContext;
}

export function getConfig(): HardhatConfig {
  return getContext().environment.config;
}

export function setConfig(config: HardhatConfig) {
  (<any>getContext().environment).config = config;
}

export function getHardhatArguments(): HardhatArguments {
  return getEnvHardhatArguments(HARDHAT_PARAM_DEFINITIONS, process.env);
}
