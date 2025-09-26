#!/bin/bash

# New Market Upgrade Script Wrapper
# This script provides a simple interface to propose a new market upgrade using the TypeScript script

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
    echo -e "${BLUE}🚀 New Market Upgrade Script Wrapper${NC}"
    echo ""
    echo "Usage: ./scripts/governor/propose/market-phase-2/index.sh [options]"
    echo ""
    echo "Options:"
    echo "  -n, --network <network>                    Network to use (required)"
    echo "  -d, --deployment <market>                  Market to upgrade (required)"
    echo "  -i, --implementation <addr>                New implementation contract address (required)"
    echo "  -h, --help                                 Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Propose upgrade for DAI market on local network"
    echo "  ./scripts/governor/propose/market-phase-2/index.sh -n local -d dai -i 0x1234567890123456789012345678901234567890"
    echo ""
    echo "  # Propose upgrade for USDC market on polygon network"
    echo "  ./scripts/governor/propose/market-phase-2/index.sh -n polygon -d usdc -i 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    echo ""
    echo "  # Propose upgrade for WETH market on mainnet"
    echo "  ./scripts/governor/propose/market-phase-2/index.sh -n mainnet -d weth -i 0x9876543210987654321098765432109876543210"
    echo ""
    echo ""
    echo "Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc."
    echo "Available markets: dai, usdc, usdt, weth, wbtc, etc."
    echo ""
    echo "Features:"
    echo "  - Uses the governor:propose-upgrade command to create upgrade proposals"
    echo "  - Shows the new implementation address being proposed"
    echo "  - Provides clear feedback on proposal creation"
    echo "  - Includes comprehensive error handling and troubleshooting tips"
    echo "  - Shows next steps for the governance process"
    echo ""
    echo "Note: This script creates a proposal for upgrading a market. The proposal will need to go"
    echo "through the complete governance process (approve, queue, execute) before the upgrade"
    echo "takes effect."
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
IMPLEMENTATION=""

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
        -i|--implementation)
            IMPLEMENTATION="$2"
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
    if [[ -z "$NETWORK" || -z "$DEPLOYMENT" || -z "$IMPLEMENTATION" ]]; then
        print_error "Network, deployment, and implementation are all required"
        show_help
        exit 1
    fi

    print_info "Starting new market upgrade proposal process..."
    print_info "Network: $NETWORK"
    print_info "Deployment: $DEPLOYMENT"
    print_info "New implementation address: $IMPLEMENTATION"
    print_info "Using BDAG custom governor (default)"
    
    # Check requirements
    check_requirements
    
    # Run the upgrade proposal script
    print_info "Executing new market upgrade proposal script..."
    
    yarn ts-node scripts/governor/propose/market-phase-2/index.ts \
        --network "$NETWORK" \
        --deployment "$DEPLOYMENT" \
        --implementation "$IMPLEMENTATION"
    
    print_success "New market upgrade proposal script completed"
}

# Run main function
main "$@"
