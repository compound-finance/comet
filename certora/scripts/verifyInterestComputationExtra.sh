if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun certora/harness/CometHarnessInterest.sol contracts/CometExt.sol certora/harness/SymbolicBaseToken.sol certora/harness/SymbolicAssetTokenA.sol certora/harness/SymbolicAssetTokenB.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarnessInterest:certora/specs/interestComputationExtra.spec $RULE \
    --link CometHarnessInterest:baseTokenPriceFeed=SymbolicPriceOracleA CometHarnessInterest:extensionDelegate=CometExt \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "Comet intereest computation Extra $RULE"
