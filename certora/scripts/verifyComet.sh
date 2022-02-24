
certoraRun certora/harness/CometHarness.sol certora/harness/SymbolicBaseToken.sol certora/harness/SymbolicAssetTokenA.sol certora/harness/SymbolicAssetTokenB.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarness:certora/specs/comet.spec  \
    --link CometHarness:baseToken=SymbolicBaseToken \
    --solc solc8.11 \
    --staging shelly/integrateJohnsBranches \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2,-solver=z3 \
        --rule $1 \
    --msg "CometHarness:comet.spec $1 : $2"