
certoraRun certora/harness/CometHarness.sol certora/harness/SymbolicBaseToken.sol \
    --verify CometHarness:certora/specs/comet.spec  \
    --link CometHarness:baseToken=SymbolicBaseToken \
    --solc solc8.11 \
    --staging jtoman/solc8-overflow \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false \
    --rule test
    --msg "CometHarness:comet.spec test"