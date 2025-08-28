#!/bin/bash

# Market Deployment Script Wrapper
# This script provides a simple interface to deploy markets using the TypeScript deployment script

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
    echo -e "${BLUE}🚀 Market Deployment Script Wrapper${NC}"
    echo ""
    echo "Usage: ./scripts/deploy-market.sh [options]"
    echo ""
    echo "Options:"
    echo "  -n, --network <network>     Network to deploy to (default: local)"
    echo "  -d, --deployment <market>   Market to deploy (default: dai)"
    echo "  -b, --bdag                  Use BDAG custom governor"
echo "  -c, --clean                 Clean deployment cache before deploying"
    
    echo "  -h, --help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Deploy DAI market on local network with BDAG governor"
    echo "  ./scripts/deploy-market.sh -n local -d dai -b"
    echo ""
    echo "  # Deploy USDC market on polygon network"
echo "  ./scripts/deploy-market.sh -n polygon -d usdc"
echo ""
echo "  # Deploy with clean cache"
echo "  ./scripts/deploy-market.sh -n local -d dai -c"
    echo ""
    
    echo ""
    echo "Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc."
    echo "Available markets: dai, usdc, usdt, weth, wbtc, etc."
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

# Function to build the project
build_project() {
    print_info "Building project..."
    yarn build
    print_success "Project built successfully"
}

# Parse command line arguments
NETWORK="local"
DEPLOYMENT="dai"
BDAG_FLAG=""
CLEAN_FLAG=""


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
        -b|--bdag)
            BDAG_FLAG="--bdag"
            shift
            ;;
        -c|--clean)
            CLEAN_FLAG="--clean"
            shift
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
    print_info "Starting market deployment process..."
    print_info "Network: $NETWORK"
    print_info "Deployment: $DEPLOYMENT"
    
    if [[ -n "$BDAG_FLAG" ]]; then
        print_info "Using BDAG custom governor"
    fi
    
    if [[ -n "$CLEAN_FLAG" ]]; then
        print_info "Clean mode enabled"
    fi
    

    
    # Check requirements
    check_requirements
    
    # Build project
    build_project
    
    # Run the deployment script
    print_info "Executing deployment script..."
    
    yarn ts-node scripts/deploy-market.ts \
        --network "$NETWORK" \
        --deployment "$DEPLOYMENT" \
        $BDAG_FLAG \
        $CLEAN_FLAG
    
    print_success "Deployment script completed"
}

# Run main function
main "$@" 