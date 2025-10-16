# ================================
# Build stage
# ================================
FROM node:22 AS build

WORKDIR /app

# Install Python (for any build tools) and curl
RUN apt-get update && apt-get install -y python3 python3-pip python3-distutils curl

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy rest of the source and build the project
COPY . .
RUN npm run build


# ================================
# Production stage
# ================================
FROM python:3.11-slim AS production

WORKDIR /app

# Install Node.js 22.x and necessary build dependencies for Python libraries
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        gnupg \
        build-essential \
        python3-pip \
        # Dependencies for Pillow
        libjpeg-dev \
        zlib1g-dev \
        # Node.js setup
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Check installed versions
# This will now work correctly as `pip3` is installed and ready
RUN python3 --version && pip3 --version && node --version && npm --version

# ==================================
# ✅ Install Python dependencies early
# ==================================
# If requirements.txt exists, install from it; otherwise, install manually
COPY src/image_generator/requirements.txt ./requirements.txt
RUN if [ -f requirements.txt ]; then \
        pip3 install --no-cache-dir -r requirements.txt; \
    else \
        pip3 install --no-cache-dir requests pillow; \
    fi

# ==================================
# Copy Node app files and install production dependencies
# ==================================
COPY package*.json ./
RUN npm ci --legacy-peer-deps --only=production

# Copy build outputs and necessary assets from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/prompts ./prompts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma/client ./node_modules/.prisma/client
COPY --from=build /app/src/image_generator ./src/image_generator

# Expose the app port
EXPOSE 8080

# Default command
CMD ["node", "dist/index.js"]