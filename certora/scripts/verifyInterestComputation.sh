certoraRun certora/harness/CometHarnessInterest.sol \
    --verify CometHarnessInterest:certora/specs/interestComputation.spec  \
    --solc solc8.10 \
    --staging \
    --optimistic_loop \
    --rule=$1 \
    --msg "Comet $1"