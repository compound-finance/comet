
certoraRun contracts/CometExt.sol certora/harness/CometHarness.sol certora/harness/SymbolicBaseToken.sol certora/harness/SymbolicAssetTokenA.sol certora/harness/SymbolicAssetTokenB.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarness:certora/specs/comet.spec  \
    --link CometHarness:baseToken=SymbolicBaseToken CometHarness:extensionDelegate=CometExt \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --rule test_correlation_maps_index \
    --method "withdrawFrom(address, address, address, uint256)" \
    --msg "CometHarness:comet.spec $1"
