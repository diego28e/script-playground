# Pocket TTS (Kyutai, docs/voice.md "The free voice"): a small text-to-speech model that runs on the CPU, served over
# HTTP for the learning service only (on the lab's private voice network), as the explainers' free voice and their
# last fallback when Deepgram can't read a reply. One container per language (POCKET_LANGUAGE: english or spanish),
# each with its model in memory.
#
# Measured on the lab server (Ampere Neoverse-N1, 2 cores), 2026-11-25: 1.66 to 1.70 times faster than real time, each
# request starting in 100 to 150 ms. Quantized (int8, POCKET_QUANTIZE=1): 1.62 to 1.95 times, each request starting in
# 250 to 450 ms; it sounded the same, by ear. Normal is the default (your choice, 2026-11-25).
FROM python:3.12-slim

# Pinned, so a rebuild can't change the voice or break the quantized mode (PyTorch deprecates the int8 calls it uses).
# The CPU build of PyTorch: PyPI's default is the CUDA one, gigabytes larger and of no use here.
ARG POCKET_TTS_VERSION=4.0.1
ARG TORCH_VERSION=2.15.0
RUN pip install --no-cache-dir --root-user-action=ignore "pocket-tts==${POCKET_TTS_VERSION}" "torch==${TORCH_VERSION}" \
      --extra-index-url https://download.pytorch.org/whl/cpu

# The models are downloaded on the first start into this folder, which compose keeps on the pocket-tts-cache volume.
# No Hugging Face sign-in is needed for the built-in voices (checked 2026-11-25).
ENV HF_HOME=/root/.cache/huggingface \
    PYTHONUNBUFFERED=1 \
    POCKET_LANGUAGE=english \
    POCKET_QUANTIZE=0

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["sh", "-c", "exec pocket-tts serve --host 0.0.0.0 --port 8000 --language \"$POCKET_LANGUAGE\" $( [ \"$POCKET_QUANTIZE\" = 1 ] && echo --quantize )"]
