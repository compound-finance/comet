#!/bin/bash

# Test Market Script Wrapper
# This script provides a simple interface to test a market deployment

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
    echo -e "${BLUE}🧪 Test Market Script Wrapper${NC}"
    echo ""
    echo "Usage: ./scripts/governor/test-market-setup/index.sh [options]"
    echo ""
    echo "Options:"
    echo "  -n, --network <network>                    Network to use (required)"
    echo "  -d, --deployment <market>                  Market to test (required)"
    echo "  -h, --help                                 Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Test DAI market on local network"
    echo "  ./scripts/governor/test-market-setup/index.sh -n local -d dai"
    echo ""
    echo "  # Test USDC market on polygon"
    echo "  ./scripts/governor/test-market-setup/index.sh -n polygon -d usdc"
    echo ""
    echo "  # Test WETH market on mainnet"
    echo "  ./scripts/governor/test-market-setup/index.sh -n mainnet -d weth"
    echo ""
    echo ""
    echo "Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc."
    echo "Available markets: dai, usdc, usdt, weth, wbtc, etc."
    echo ""
    echo "Features:"
    echo "  - Executes deployment verification test (includes spider)"
    echo "  - Provides comprehensive error handling and troubleshooting tips"
    echo "  - Allows continuation despite non-critical failures"
    echo ""
    echo "Note: This script tests a market deployment by running the deployment verification test."
    echo "The verification test includes running spider to refresh roots.json."
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
DEPLOYMENT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--network)
            NETWORK="$2"
            shift 2
            ;;
        -d|--deployment)
            DEPLOYMENT="$2"
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
    if [[ -z "$NETWORK" || -z "$DEPLOYMENT" ]]; then
        print_error "Network and deployment are both required"
        show_help
        exit 1
    fi

    print_info "Starting market testing process..."
    print_info "Network: $NETWORK"
    print_info "Deployment: $DEPLOYMENT"
    
    # Check requirements
    check_requirements
    
    # Run the test script
    print_info "Executing market test script..."
    
    yarn ts-node scripts/governor/test-market-setup/index.ts \
        --network "$NETWORK" \
        --deployment "$DEPLOYMENT"
    
    print_success "Market test script completed"
}

# Run main function
main "$@"
