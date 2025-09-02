#!/bin/bash

# Timelock Delay Change Script Wrapper
# This script provides a simple interface to change timelock delays using the TypeScript script

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
    echo -e "${BLUE}⏰ Timelock Delay Change Script Wrapper${NC}"
    echo ""
    echo "Usage: ./scripts/timelock-delay-change/index.sh [options]"
    echo ""
    echo "Options:"
    echo "  -n, --network <network>     Network to use (default: local)"
    echo "  -h, --help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Change timelock delay on local network (delay will be asked interactively)"
    echo "  ./scripts/timelock-delay-change/index.sh -n local"
    echo ""
    echo "  # Change timelock delay on mainnet (delay will be asked interactively)"
    echo "  ./scripts/timelock-delay-change/index.sh -n mainnet"
    echo ""
    echo "Delay examples (when prompted):"
    echo "  86400  = 1 day"
    echo "  172800 = 2 days"
    echo "  3600   = 1 hour"
    echo "  1800   = 30 minutes"
    echo "  300    = 5 minutes"
    echo ""
    echo "Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc."
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
NETWORK="local"

while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--network)
            NETWORK="$2"
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
    print_info "Starting Timelock Delay Change process..."
    print_info "Network: $NETWORK"
    print_info "Delay value will be asked interactively"
    
    # Check requirements
    check_requirements
    
    # Run the delay change script
    print_info "Executing delay change script..."
    
    yarn ts-node scripts/timelock-delay-change/index.ts \
        --network "$NETWORK"
    
    print_success "Delay change script completed"
}

# Run main function
main "$@" 