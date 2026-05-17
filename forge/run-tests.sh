
#!/bin/bash

set -e  # Stopping on error

# 1. Export network configurations to a temporary file
node scripts/exportNetworkConfigs.js

# 2. Load environment variables from the temporary file
export $(cat .env.forge-temp | xargs)

# 3. Run the Forge tests
#
# Skip:
# - contracts/capo/* — submodule clean-tree only; not part of our test set
# - MarketUpdate*DeploymentTest — fork mainnet/L2s via vm.createSelectFork
#   which fails Connection-refused when RPC env vars aren't set.  These
#   are upstream Compound governance-deploy tests; the Rome fork doesn't
#   exercise that flow and the QuickNode secrets are not provisioned in
#   this org.  Run locally with QUICKNODE_LINKs set when needed.
# - PolygonLiquidator — same fork pattern; same skip rationale.
forge test -vvv --via-ir --optimizer-runs 1 \
  --no-match-path "./contracts/capo/*" \
  --no-match-contract "MarketUpdate.*DeploymentTest|PolygonLiquidatorTest"

# 4. Delete the temporary environment file
rm .env.forge-temp
# To test a specific test case in Foundry, use the --match-test flag:
# Example: forge test --match-test testFunctionName -vvvv