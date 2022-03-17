if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun certora/harness/CometHarnessWrappers.sol contracts/CometExt.sol certora/harness/SymbolicBaseToken.sol certora/harness/SymbolicAssetTokenA.sol certora/harness/SymbolicAssetTokenB.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarnessWrappers:certora/specs/interestComputationExtra.spec $RULE \
    --link CometHarnessWrappers:baseTokenPriceFeed=SymbolicPriceOracleA CometHarnessWrappers:extensionDelegate=CometExt \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "Comet intereest computation Extra $RULE"
