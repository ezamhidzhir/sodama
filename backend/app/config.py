import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
AUDIO_BUCKET = os.environ.get("AUDIO_BUCKET", "audio-files")

# Classification pipeline
YAMNET_TOP_K = int(os.environ.get("YAMNET_TOP_K", "3"))
YAMNET_MIN_CONFIDENCE = float(os.environ.get("YAMNET_MIN_CONFIDENCE", "0.1"))

# Privacy filter (app/privacy.py): a window counts as speech when any speech
# class scores at least this; muted stretches are widened by the padding.
PRIVACY_SPEECH_THRESHOLD = float(os.environ.get("PRIVACY_SPEECH_THRESHOLD", "0.3"))
PRIVACY_PADDING_SECONDS = float(os.environ.get("PRIVACY_PADDING_SECONDS", "0.5"))
# An upload or recording that is at least this share speech is refused outright.
PRIVACY_MAX_SPEECH_SHARE = float(os.environ.get("PRIVACY_MAX_SPEECH_SHARE", "0.8"))

# Limits — seconds of audio
MAX_UPLOAD_SECONDS = int(os.environ.get("MAX_UPLOAD_SECONDS", "600"))        # 10 min per file
MAX_RECORDING_SECONDS = int(os.environ.get("MAX_RECORDING_SECONDS", "300"))  # 5 min per take
DEFAULT_QUOTA_SECONDS = 1800                                                 # 30 min per user

# Where TF Hub caches the downloaded YAMNet model. Its default lives under the
# OS temp directory, which Windows cleanup wipes — leaving an empty folder that
# TF Hub still treats as a valid cache, so loading fails with "contains neither
# saved_model.pb nor saved_model.pbtxt". Keep it inside the project instead.
YAMNET_CACHE_DIR = Path(os.environ.get(
    "TFHUB_CACHE_DIR", Path(__file__).resolve().parents[1] / "yamnet_cache"))
YAMNET_CACHE_DIR.mkdir(parents=True, exist_ok=True)
os.environ["TFHUB_CACHE_DIR"] = str(YAMNET_CACHE_DIR)
