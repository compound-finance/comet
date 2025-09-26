#!/bin/bash

# Execute Proposal Script Wrapper
# This script provides a simple interface to execute a proposal using the TypeScript script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to show help
show_help() {
    echo -e "${BLUE}🎯 Execute Proposal Script Wrapper${NC}"
    echo ""
    echo "Usage: ./scripts/governor/execute-proposal/index.sh [options]"
    echo ""
    echo "Options:"
    echo "  -n, --network <network>     Network to use (required)"
    echo "  -p, --proposal-id <id>     Proposal ID to execute (required)"
    echo "  -t, --execution-type <type> Execution type (required)"
    echo "  -h, --help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Execute proposal 1 on local network with comet upgrade type"
    echo "  ./scripts/governor/execute-proposal/index.sh -n local -p 1 -t comet-upgrade"
    echo ""
    echo "  # Execute proposal 5 on polygon network with implementation type"
    echo "  ./scripts/governor/execute-proposal/index.sh -n polygon -p 5 -t comet-impl-in-configuration"
    echo ""
    echo "  # Execute proposal 10 on mainnet with governance config type"
    echo "  ./scripts/governor/execute-proposal/index.sh -n mainnet -p 10 -t governance-config"
    echo ""
    echo ""
    echo "Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc."
    echo ""
    echo "Available execution types:"
    echo "  - comet-impl-in-configuration: For Comet implementation deployments"
    echo "  - comet-upgrade: For Comet upgrades"
    echo "  - governance-config: For governance configuration changes"
    echo "  - timelock-delay-change: For timelock delay changes"
    echo "  - comet-reward-funding: For Comet reward funding"
    echo ""
    echo "Features:"
    echo "  - Uses the governor:execute command to execute queued proposals"
    echo "  - Requires execution type for proper log parsing"
    echo "  - Provides clear feedback on execution status"
    echo "  - Includes comprehensive error handling and troubleshooting tips"
    echo ""
    echo "Note: This script executes the proposal. The proposal must be queued and the timelock"
    echo "delay period must have passed. The execution type is required for parsing relevant logs"
    echo "from the transaction."
}

# Function to check if required tools are installed
check_requirements() {
    print_info "Checking requirements..."
    
    # Check if yarn is installed
    if ! command -v yarn &> /dev/null; then
        print_error "yarn is not installed. Please install yarn first."
        exit 1
    fi
    
    # Check if ts-node is available
    if ! yarn ts-node --version &> /dev/null; then
        print_error "ts-node is not available. Please run 'yarn install' first."
        exit 1
    fi
    
    print_success "Requirements check passed"
}

# Parse command line arguments
NETWORK=""
PROPOSAL_ID=""
EXECUTION_TYPE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--network)
            NETWORK="$2"
            shift 2
            ;;
        -p|--proposal-id)
            PROPOSAL_ID="$2"
            shift 2
            ;;
        -t|--execution-type)
            EXECUTION_TYPE="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
main() {
    # Validate required arguments
    if [[ -z "$NETWORK" || -z "$PROPOSAL_ID" || -z "$EXECUTION_TYPE" ]]; then
        print_error "Network, proposal-id, and execution-type are all required"
        show_help
        exit 1
    fi

    print_info "Starting proposal execution process..."
    print_info "Network: $NETWORK"
    print_info "Proposal ID: $PROPOSAL_ID"
    print_info "Execution type: $EXECUTION_TYPE"
    print_info "This will execute the queued proposal"
    
    # Check requirements
    check_requirements
    
    # Run the execution script
    print_info "Executing proposal script..."
    
    yarn ts-node scripts/governor/execute-proposal/index.ts \
        --network "$NETWORK" \
        --proposal-id "$PROPOSAL_ID" \
        --execution-type "$EXECUTION_TYPE"
    
    print_success "Execute proposal script completed"
}

# Run main function
main "$@"
