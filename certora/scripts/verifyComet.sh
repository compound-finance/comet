
certoraRun certora/harness/CometHarness.sol certora/harness/SymbolicBaseToken.sol \
    --verify CometHarness:certora/specs/comet.spec  \
    --link CometHarness:baseToken=SymbolicBaseToken \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false \
    --rule $1 \
    --msg "CometHarness:comet.spec $1 with magic flag"