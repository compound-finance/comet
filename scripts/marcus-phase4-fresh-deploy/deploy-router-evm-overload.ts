// Phase E.2: redeploy OrchestratorRouter against the live UnifiedToken +
// supply-only Comet on Marcus, with the new EVM-keypair overloads
// (snapshotForPendingSupplyEvm / completeSupplyForUserEvm /
// cancelPendingSnapshotEvm). Then grant pre-deposited caller role to the
// new Router (the old Router can stay live but is no longer the active path).
//
// Run: ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//      npx hardhat run scripts/marcus-phase4-fresh-deploy/deploy-router-evm-overload.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const ADDR = {
  unifiedToken: '0xe76bb4c8C0f50C75eE348E91ddd34f4043582aCC',
  cometProxy:   '0xDf203b46C89921537F24beA30046eb1FF8c3FCD3', // supply-only
};

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`Admin (= relayer for now): ${admin.address}\n`);

  // Sanity: admin should be the UnifiedToken admin (the one who can grant
  // preDepositedCaller). bench scripts confirm this is `0xe4abFBCa…30AF`
  // for the Phase 4 deployment.
  const tokenAdminAbi = [
    'function admin() view returns (address)',
    'function grantPreDepositedCaller(address) external',
    'function isPreDepositedCaller(address) view returns (bool)',
  ];
  const token = new ethers.Contract(ADDR.unifiedToken, tokenAdminAbi, admin);
  const tokenAdmin = await token.admin();
  console.log(`UnifiedToken.admin: ${tokenAdmin}`);
  if (tokenAdmin.toLowerCase() !== admin.address.toLowerCase()) {
    throw new Error(`signer is not UnifiedToken admin (got ${tokenAdmin})`);
  }

  console.log(`\n[1/2] Deploy new OrchestratorRouter…`);
  const Router = await ethers.getContractFactory('OrchestratorRouter');
  const router = await Router.deploy(
    ADDR.cometProxy,
    ADDR.unifiedToken,
    admin.address, // initialRelayer = admin for the demo; rotate later via setRelayerAuthorization
    { gasLimit: 50_000_000 },
  );
  await router.deployed();
  console.log(`      ${router.address}  tx=${router.deployTransaction.hash}`);

  console.log(`\n[2/2] Grant preDepositedCaller(newRouter)…`);
  const grantTx = await token.grantPreDepositedCaller(router.address, { gasLimit: 5_000_000 });
  const r = await grantTx.wait();
  console.log(`      tx=${grantTx.hash}  block=${r.blockNumber}`);

  // Verify role landed.
  const has = await token.isPreDepositedCaller(router.address);
  console.log(`      isPreDepositedCaller(newRouter) = ${has}`);
  if (!has) throw new Error('grant did not land');

  // Verify new functions are present.
  const evmFnAbi = [
    'function snapshotForPendingSupplyEvm(address,uint256) external',
    'function completeSupplyForUserEvm(address,uint256) external',
    'function cancelPendingSnapshotEvm(address) external',
    'function pendingSnapshotAmountEvm(address) view returns (uint256)',
  ];
  const newRouter = new ethers.Contract(router.address, evmFnAbi, admin);
  const probe = await newRouter.pendingSnapshotAmountEvm(admin.address);
  console.log(`      pendingSnapshotAmountEvm(admin) = ${probe.toString()} (sanity read OK)`);

  const out = {
    network: 'marcus',
    chainId: 121301,
    deployer: admin.address,
    timestamp: new Date().toISOString(),
    addresses: {
      newOrchestratorRouter: router.address,
      // For comparison
      oldOrchestratorRouter: '0x02Ed3401ba0f75a2ebF4E3f724B1C115EC110914',
      unifiedToken: ADDR.unifiedToken,
      cometProxy: ADDR.cometProxy,
    },
    txReceipts: {
      deploy: router.deployTransaction.hash,
      grantPreDeposited: grantTx.hash,
    },
  };
  const outPath = path.join(__dirname, 'deploy-router-evm-overload.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
  console.log(`\nNext: update demo's NEXT_PUBLIC_ORCHESTRATOR_ROUTER → ${router.address}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
