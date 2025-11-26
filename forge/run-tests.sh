
#!/bin/bash

set -e  # Stopping on error

# 1. Export network configurations to a temporary file
node scripts/exportNetworkConfigs.js

# 2. Load environment variables from the temporary file
export $(cat .env.forge-temp | xargs)

# 3. Run the Forge tests
forge test -vvv --via-ir --optimizer-runs 1 --no-match-path "./contracts/capo/*"

# 4. Delete the temporary environment file
rm .env.forge-temp
# To test a specific test case in Foundry, use the --match-test flag:
# Example: forge test --match-test testFunctionName -vvvv