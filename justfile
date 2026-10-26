set positional-arguments

# List available commands.
default:
    @just --list

# Install the locked JavaScript dependencies.
install:
    bun install --frozen-lockfile

# Install Chromium for local end-to-end tests.
browsers:
    bunx playwright install chromium

# Set up dependencies and the test browser.
setup: install browsers

# Start the local development server (optional Vite flags).
dev *args:
    bun run dev "$@"

# Type-check and build the optimized app locally.
build:
    bun run build

# Build and serve a fresh production preview on localhost.
preview *args: build
    bun run preview "$@"

# Run ESLint (for example: just lint --fix).
lint *args:
    bun run lint "$@"

# Format source files.
format:
    bun run format

# Check source formatting without changing files.
format-check:
    bun run format:check

# Run unit tests (optional Vitest flags).
test *args:
    bun run test "$@"

# Run desktop and mobile E2E tests (optional Playwright flags).
e2e *args:
    bun run test:e2e "$@"

# Run data-importer tests.
data-test:
    bun run data:test

# Validate the checked-in regional snapshots and report coverage.
data-validate:
    bun run data:validate

# Refresh a region from free public data; accepts additional importer flags.
data-refresh region="peninsula-south-bay" *args:
    bun run data:refresh --region "$@"

# Run all repository checks, including E2E tests and the production build.
check: format-check lint test data-test data-validate e2e build

# Refresh city and reference-neighborhood polygons without downloading prices.
data-boundaries region="peninsula-south-bay":
    bun run data:boundaries --region "$@"

# Audit local sold-home CSVs and calculate neighborhood export-sample statistics.
data-sales *args:
    bun run data:sales "$@"
