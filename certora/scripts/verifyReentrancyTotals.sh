if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun certora/munged/CometExt.sol certora/harness/CometHarness.sol certora/harness/SymbolicBaseToken.sol certora/harness/ERC20WithCallBack.sol certora/harness/SymbolicAssetTokenB.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarness:certora/specs/cometTotalsAndBalances.spec $RULE \
    --link CometHarness:baseToken=SymbolicBaseToken CometHarness:extensionDelegate=CometExt ERC20WithCallBack:comet=CometHarness \
    --solc solc8.15 \
    --cloud \
    --optimistic_loop \
    --settings -contractRecursionLimit=1,-enableEqualitySaturation=false,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometHarness:cometTotalsAndBalances.spec Reentrancy $RULE"
