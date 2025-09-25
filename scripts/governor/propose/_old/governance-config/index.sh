#!/bin/bash

# Governance Configuration Change Script Wrapper
# This script provides a simple interface to change governance configuration using the TypeScript script

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
    echo -e "${BLUE}🔧 Governance Configuration Change Script Wrapper${NC}"
    echo ""
    echo "Usage: ./scripts/governor/propose/_old/governance-config/index.sh [options]"
    echo ""
    echo "Options:"
    echo "  -n, --network <network>     Network to use (default: local)"
    echo "  -d, --deployment <market>   Deployment to use (default: dai)"
    echo "  -h, --help                  Show this help message"
    echo ""
    echo "Examples:"
    echo "  # Change governance configuration on local network (interactive)"
    echo "  ./scripts/governor/propose/_old/governance-config/index.sh -n local -d dai"
    echo ""
    echo "  # Change governance configuration on polygon network (interactive)"
    echo "  ./scripts/governor/propose/_old/governance-config/index.sh -n polygon -d usdc"
    echo ""
    echo "Interactive prompts:"
    echo "  - Admin addresses: Enter comma-separated list of admin addresses"
    echo "  - Threshold: Enter number of required approvals"
    echo "  - Confirmation: Confirm the configuration before proceeding"
    echo ""
    echo "Note: This script will guide you through the complete governance process:"
    echo "  1. Create proposal"
    echo "  2. Approve proposal (if you choose to)"
    echo "  3. Queue proposal (if you choose to)"
    echo "  4. Execute proposal (if you choose to)"
    echo ""
    echo "Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc."
    echo "Available deployments: dai, usdc, usdt, weth, wbtc, etc."
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
DEPLOYMENT="dai"

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
    print_info "Starting Governance Configuration Change process..."
    print_info "Network: $NETWORK"
    print_info "Deployment: $DEPLOYMENT"
    print_info "Configuration will be asked interactively"
    
    # Check requirements
    check_requirements
    
    # Run the governance configuration script
    print_info "Executing governance configuration script..."
    
    yarn ts-node scripts/governance-config/index.ts \
        --network "$NETWORK" \
        --deployment "$DEPLOYMENT"
    
    print_success "Governance configuration script completed"
}

# Run main function
main "$@"
