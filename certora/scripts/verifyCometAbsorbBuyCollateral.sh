if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun certora/munged/CometExt.sol certora/harness/CometHarness.sol certora/harness/SymbolicBaseToken.sol certora/harness/SymbolicAssetTokenA.sol certora/harness/SymbolicAssetTokenB.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarness:certora/specs/cometAbsorbBuyCollateral.spec \
    --link CometHarness:baseToken=SymbolicBaseToken CometHarness:extensionDelegate=CometExt \
    --solc solc8.15 \
    --cloud \
    $RULE \
    --optimistic_loop \
    --loop_iter 2 \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometHarness:cometAbsorbBuyCollateral.spec $RULE"
