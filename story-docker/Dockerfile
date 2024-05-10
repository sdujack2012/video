FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get -y update \
    && apt-get install -y software-properties-common \
    && add-apt-repository ppa:deadsnakes/ppa

RUN apt install -y bash \
    build-essential \
    git \
    git-lfs \
    curl \
    ca-certificates \
    libsndfile1-dev \
    libgl1 \
    ffmpeg \
    python3.10 \
    python3-pip \
    python3.10-venv && \
    rm -rf /var/lib/apt/lists

# make sure to use venv
RUN python3.10 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# pre-install the heavy dependencies (these can later be overridden by the deps from setup.py)
RUN python3.10 -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
RUN python3.10 -m pip install invisible_watermark \
	transformers \
	accelerate \
	safetensors

RUN python3.10 -m pip install --upgrade diffusers[torch]
RUN python3.10 -m pip install --no-cache-dir fastapi \
	requests \
	uvicorn[standard] \
	sentencepiece

RUN python3.10 -m pip install --no-cache-dir TTS
RUN python3.10 -m pip install -U openai-whisper
RUN python3.10 -m pip install pydantic

# Set up a new user named "user" with user ID 1000
RUN useradd -m -u 1000 user
# Switch to the "user" user
USER user
# Set home to the user's home directory
ENV HOME=/home/user \
	PATH=/home/user/.local/bin:$PATH \
	HF_HOME=/hf_home \
	HF_HUB_CACHE=/hf_home/models \
	HF_TOKEN=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 \
    TTS_HOME=/tts_home

# Set the working directory to the user's home directory
WORKDIR $HOME/app
EXPOSE 8080
# Copy the current directory contents into the container at $HOME/app setting the owner to the user
COPY --chown=user . $HOME/app

ENTRYPOINT ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]