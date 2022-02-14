certoraRun certora/harness/CometHarnessWrappers.sol \
    --verify CometHarnessWrappers:certora/specs/CollateralAsset.spec  \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --settings -useBitVectorTheory \
    --msg "$1"