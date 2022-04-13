# if [[ "$1" ]]
# then
#     RULE="--rule $1"
# fi

certoraRun certora/harness/CometHarnessWrappers.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarnessWrappers:certora/specs/interestComputation.spec \
    --link CometHarnessWrappers:baseTokenPriceFeed=SymbolicPriceOracleA \
    --solc solc8.11 \
    --cloud \
    --rule $1 \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometHarnessWrappers:interestComputation.spec $1"
