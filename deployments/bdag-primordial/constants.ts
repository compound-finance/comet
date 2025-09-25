/**
 * Token addresses for BDAG Primordial network
 * These addresses represent the deployed token contracts on the BDAG Primordial network
 */

export const TOKEN_ADDRESSES = {
  DAI: '0xeF4555a8ee300250DeFa1f929FEfa2A3a9af628a',
  WETH: '0xf5aD60F3B4F86D1Ef076fB4e26b4A4FeDbE7a93b',
  WBTC: '0x7c9Dfdc92A707937C4CfD1C21B3BBA5220D4f3A2',
  LINK: '0x4686A8C76a095584112AC3Fd0362Cb65f7C11b8B',
  UNI: '0xc1031Cfd04d0c68505B0Fc3dFdfC41DF391Cf6A6',
  USDC: '0x27E8e32f076e1B4cc45bdcA4dbA5D9D8505Bab43',
} as const;

/**
 * All addresses combined for easy access
 */
export const BDAG_PRIMORDIAL_ADDRESSES = {
  tokens: TOKEN_ADDRESSES,
} as const;

export default BDAG_PRIMORDIAL_ADDRESSES;
