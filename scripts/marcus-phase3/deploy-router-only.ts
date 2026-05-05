// Phase 3 — Deploy router only (V3 impl already deployed + proxy upgraded
// in deploy-router-and-v3-impl.ts; that run died at the router step due to
// undersized gasLimit).

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const ADDR = {
  COMET_PROXY: '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c',
  UNIFIED_TOKEN_V2: '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31',
  COMET_IMPL_V3: '0xE27fA4Fcefa100C07161a4d9999d8c5255c48d4f',
};

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Deployer: ${signer.address}`);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: signer.address,
    inputs: ADDR,
  };

  console.log('Deploying OrchestratorRouter…');
  const Router = await ethers.getContractFactory('OrchestratorRouter');
  const router = await Router.deploy(
    ADDR.COMET_PROXY,
    ADDR.UNIFIED_TOKEN_V2,
    { gasLimit: 25_000_000 },
  );
  await router.deployed();
  console.log(`  OrchestratorRouter: ${router.address}`);
  out.orchestratorRouter = router.address;

  // Grant pre-deposited caller roles
  console.log('\nGranting pre-deposited caller roles…');
  const tokenAbi = [
    'function admin() view returns (address)',
    'function grantPreDepositedCaller(address) external',
    'function isPreDepositedCaller(address) view returns (bool)',
  ];
  const token = new ethers.Contract(ADDR.UNIFIED_TOKEN_V2, tokenAbi, signer);
  if (!(await token.isPreDepositedCaller(router.address))) {
    const t = await token.grantPreDepositedCaller(router.address, { gasLimit: 5_000_000 });
    await t.wait();
    console.log(`  granted router (${router.address})`);
    out.grantRouterTx = t.hash;
  }
  if (!(await token.isPreDepositedCaller(ADDR.COMET_PROXY))) {
    const t = await token.grantPreDepositedCaller(ADDR.COMET_PROXY, { gasLimit: 5_000_000 });
    await t.wait();
    console.log(`  granted comet proxy (${ADDR.COMET_PROXY})`);
    out.grantCometTx = t.hash;
  }

  out.verifications = {
    routerBaseAsset: await router.baseAsset(),
    routerComet: await router.comet(),
    routerUnifiedToken: await router.unifiedToken(),
    routerIsPreDeposited: await token.isPreDepositedCaller(router.address),
    cometIsPreDeposited: await token.isPreDepositedCaller(ADDR.COMET_PROXY),
  };
  console.log(JSON.stringify(out.verifications, null, 2));

  fs.writeFileSync(
    path.join(__dirname, 'phase3-router-deploy.json'),
    JSON.stringify(out, null, 2),
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
