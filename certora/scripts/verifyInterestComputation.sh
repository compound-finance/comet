if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun certora/harness/CometHarnessWrappers.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarnessWrappers:certora/specs/interestComputation.spec \
    --link CometHarnessWrappers:baseTokenPriceFeed=SymbolicPriceOracleA \
<<<<<<< HEAD
    --solc solc8.13 \
    --cloud \
    --disable_auto_cache_key_gen \
    $RULE \
=======
    --solc solc8.11 \
    --cloud \
    $RULE \
    --send_only \
>>>>>>> upstream/certora
    --optimistic_loop \
    --settings -enableEqualitySaturation=false \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometHarnessWrappers:interestComputation.spec $RULE"
