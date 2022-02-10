
certoraRun certora/harness/CometHarness.sol \
    --verify CometHarness:certora/specs/comet.spec  \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --rule integrityOfSupply \
    --msg "CometHarness integrityOfSupply"