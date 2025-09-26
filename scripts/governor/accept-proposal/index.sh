#!/bin/bash

# Accept Proposal Script Wrapper
# This script provides a simple interface to accept a proposal using the TypeScript script

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
    echo -e "${BLUE}🎯 Accept Proposal Script Wrapper${NC}"
    echo ""
    echo "Usage: ./scripts/governor/accept-proposal/index.sh [options]"
    echo ""
    echo "Options:"
    echo "  -n, --network <network>     Network to use (required)"
    echo "  -p, --proposal-id <id>     Proposal ID to accept (required)"
    echo "  -h, --help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Accept proposal 1 on local network"
    echo "  ./scripts/governor/accept-proposal/index.sh -n local -p 1"
    echo ""
    echo "  # Accept proposal 5 on polygon network"
    echo "  ./scripts/governor/accept-proposal/index.sh -n polygon -p 5"
    echo ""
    echo "  # Accept proposal 10 on mainnet"
    echo "  ./scripts/governor/accept-proposal/index.sh -n mainnet -p 10"
    echo ""
    echo ""
    echo "Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc."
    echo ""
    echo "Features:"
    echo "  - Checks current approval status before accepting"
    echo "  - Shows detailed approval count and requirements"
    echo "  - Displays total number of admins"
    echo "  - Provides next steps after approval"
    echo "  - Shows updated status after approval"
    echo "  - Prevents unnecessary approvals if already sufficient"
    echo ""
    echo "Note: This script only approves the proposal. You'll need to queue and execute it separately"
    echo "or use the complete governance flow script for automated processing."
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
    if [[ -z "$NETWORK" || -z "$PROPOSAL_ID" ]]; then
        print_error "Both network and proposal-id are required"
        show_help
        exit 1
    fi

    print_info "Starting proposal acceptance process..."
    print_info "Network: $NETWORK"
    print_info "Proposal ID: $PROPOSAL_ID"
    print_info "This will check approval status and accept the proposal if needed"
    
    # Check requirements
    check_requirements
    
    # Run the acceptance script
    print_info "Executing accept proposal script..."
    
    yarn ts-node scripts/governor/accept-proposal/index.ts \
        --network "$NETWORK" \
        --proposal-id "$PROPOSAL_ID"
    
    print_success "Accept proposal script completed"
}

# Run main function
main "$@"
