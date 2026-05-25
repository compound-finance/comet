// Gas-limit helper for Hardhat scripts that submit txs / deploys on Rome.
//
// Why this exists: hardcoded `gasLimit` overrides drift across wrapper /
// precompile redeploys.  Example from the V3 LP v6 cutover: cached
// SPL_ERC20_cached.balanceOf grew ~119M gas after the overlay-aware try/catch
// was added, which broke every script that pinned a 30M / 80M / 100M cap.
//
// Solution mirrors rome-ui's pattern (useTopUpUserPda.ts):
//   1. Call eth_estimateGas via ethers' estimateGas surface.
//   2. Apply a 1.3x buffer.  Absorbs small variance between simulation and
//      on-chain metering (mempool reordering, gas repricing, SPL-side cost
//      drift).  Lower buffer (1.1x) trips reverts more often; higher (2x)
//      wastes header space.
//
// References:
//   - rome-ui/src/features/portfolio/hooks/useTopUpUserPda.ts (canonical)
//   - rome-ui/src/hooks/useUniswapV3Liquidity.ts (drops gasLimit entirely;
//     wallet auto-estimates the same way)
//   - rome-protocol/registry memory note on cached-wrapper redeploy drift

import { BigNumber, Contract, ContractFactory, ContractTransaction } from 'ethers';

// 1.3x in basis points — matches rome-ui's GAS_ESTIMATE_BUFFER_BPS (13_000 / 10_000).
const GAS_BUFFER_NUM = 13;
const GAS_BUFFER_DEN = 10;

export function bufferedGas(estimate: BigNumber): BigNumber {
  return estimate.mul(GAS_BUFFER_NUM).div(GAS_BUFFER_DEN);
}

/**
 * Submit a tx on an existing contract with estimateGas-derived gasLimit.
 * Caller-supplied overrides (e.g. `value`) merge in; an explicit `gasLimit`
 * in `overrides` takes precedence (escape hatch).
 */
export async function callTx(
  contract: Contract,
  method: string,
  args: unknown[],
  overrides: Record<string, unknown> = {},
): Promise<ContractTransaction> {
  if (overrides.gasLimit !== undefined) {
    return contract[method](...args, overrides);
  }
  const estimate: BigNumber = await contract.estimateGas[method](...args, overrides);
  return contract[method](...args, { ...overrides, gasLimit: bufferedGas(estimate) });
}

/**
 * Deploy a contract via ContractFactory with estimateGas-derived gasLimit.
 * Mirrors `callTx` semantics: caller `gasLimit` in `overrides` wins.
 */
export async function deployContract<T>(
  factory: ContractFactory,
  args: unknown[] = [],
  overrides: Record<string, unknown> = {},
): Promise<T> {
  if (overrides.gasLimit !== undefined) {
    return (await factory.deploy(...args, overrides)) as unknown as T;
  }
  const deployTx = factory.getDeployTransaction(...args, overrides);
  const estimate: BigNumber = await factory.signer.estimateGas(deployTx);
  return (await factory.deploy(...args, { ...overrides, gasLimit: bufferedGas(estimate) })) as unknown as T;
}

/**
 * Send a raw transaction (e.g. signer.sendTransaction) with estimateGas-
 * derived gasLimit.  Useful for ETH transfers and direct calldata sends.
 */
export async function sendTx(
  signer: { sendTransaction: (tx: any) => Promise<any>, estimateGas: (tx: any) => Promise<BigNumber> },
  tx: Record<string, unknown>,
): Promise<any> {
  if (tx.gasLimit !== undefined) {
    return signer.sendTransaction(tx);
  }
  const estimate = await signer.estimateGas(tx);
  return signer.sendTransaction({ ...tx, gasLimit: bufferedGas(estimate) });
}
