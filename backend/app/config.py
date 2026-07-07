import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
AUDIO_BUCKET = os.environ.get("AUDIO_BUCKET", "audio-files")

# Classification pipeline
YAMNET_TOP_K = int(os.environ.get("YAMNET_TOP_K", "3"))
YAMNET_MIN_CONFIDENCE = float(os.environ.get("YAMNET_MIN_CONFIDENCE", "0.1"))
