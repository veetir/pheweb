FROM python:3.8-slim

# Set environment variables
ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libbz2-dev \
    zlib1g-dev \
    liblzma-dev \
    libcurl4-openssl-dev \
    libssl-dev \
    libncurses5-dev \
    libncursesw5-dev \
    libffi-dev \
    libsqlite3-dev \
    wget \
    curl \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create a working directory
WORKDIR /app

# Copy the PheWeb source code into the container
COPY . /app

# Install PheWeb and its dependencies
RUN pip install --upgrade pip setuptools wheel \
    && pip install -e .

# Expose the default port (5000)
EXPOSE 5000

# Entry point
ENTRYPOINT ["pheweb"]
CMD ["serve", "--host", "0.0.0.0"]
