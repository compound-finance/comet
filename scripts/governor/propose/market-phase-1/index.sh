#!/bin/bash

# New Market Implementation Script Wrapper
# This script provides a simple interface to add a new market implementation using the TypeScript deployment script

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
    echo -e "${BLUE}🚀 New Market Implementation Script Wrapper${NC}"
    echo ""
    echo "Usage: ./scripts/governor/propose/market-phase-1/index.sh [options]"
    echo ""
    echo "Options:"
    echo "  -n, --network <network>     Network to deploy to (required)"
    echo "  -d, --deployment <market>   Market to deploy (required)"
    echo "  -h, --help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Add new DAI market implementation on local network"
    echo "  ./scripts/governor/propose/market-phase-1/index.sh -n local -d dai"
    echo ""
    echo "  # Add new USDC market implementation on polygon network"
    echo "  ./scripts/governor/propose/market-phase-1/index.sh -n polygon -d usdc"
    echo ""
    echo "  # Add new WETH market implementation on mainnet"
    echo "  ./scripts/governor/propose/market-phase-1/index.sh -n mainnet -d weth"
    echo ""
    echo ""
    echo "Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc."
    echo "Available markets: dai, usdc, usdt, weth, wbtc, etc."
    echo ""
    echo "Note: This script uses BDAG custom governor and standard deploy mode by default."
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
        print_error "Both network and deployment are required"
        show_help
        exit 1
    fi

    print_info "Starting new market implementation process..."
    print_info "Network: $NETWORK"
    print_info "Deployment: $DEPLOYMENT"
    print_info "Using BDAG custom governor (default)"
    print_info "Using standard deploy mode (default)"
    
    # Check requirements
    check_requirements
    
    # Run the deployment script
    print_info "Executing new market implementation script..."
    
    yarn ts-node scripts/governor/propose/market-phase-1/index.ts \
        --network "$NETWORK" \
        --deployment "$DEPLOYMENT"
    
    print_success "New market implementation script completed"
}

# Run main function
main "$@"
