# if [[ "$1" ]]
# then
#     RULE="--rule $1"
# fi

certoraRun certora/munged/CometExt.sol certora/harness/CometHarness.sol certora/harness/SymbolicBaseToken.sol certora/harness/SymbolicAssetTokenA.sol certora/harness/SymbolicAssetTokenB.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarness:certora/specs/cometTotalsAndBalances.spec \
    --link CometHarness:baseToken=SymbolicBaseToken CometHarness:extensionDelegate=CometExt \
    --solc solc8.15 \
    --cloud \
    --rule $1 \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometHarness:cometTotalsAndBalances.spec complete $1"
