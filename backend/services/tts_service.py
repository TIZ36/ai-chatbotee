"""
ElevenLabs Text-to-Speech Service

Provides text-to-speech synthesis with support for:
- Multiple voices (21 premade + custom voices)
- Custom voice uploads (requires paid plan)
- Voice settings (stability, similarity boost)
- Streaming audio output
- Error handling and rate limit management
"""

import os
import io
import requests
import logging
from typing import Optional, Dict, List, BinaryIO, Tuple
from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib

logger = logging.getLogger(__name__)

@dataclass
class VoiceInfo:
    voice_id: str
    name: str
    category: str
    gender: str
    accent: str
    age: str
    description: str
    preview_url: str


class ElevenLabsClient:
    def __init__(self, api_key: str, api_base: str = "https://api.elevenlabs.io/v1"):
        self.api_key = api_key
        self.api_base = api_base
        self.session = requests.Session()
        self.session.headers.update({
            "xi-api-key": api_key,
            "Content-Type": "application/json"
        })
        self._voice_cache = None
        self._cache_timestamp = None
        self.cache_ttl = 3600  # 1 hour

    def _get_headers(self, content_type: str = "application/json") -> Dict:
        return {
            "xi-api-key": self.api_key,
            "Content-Type": content_type
        }

    def list_voices(self, use_cache: bool = True) -> List[VoiceInfo]:
        """
        Fetch available voices from ElevenLabs API.
        Caches results for 1 hour to avoid excessive API calls.
        """
        if use_cache and self._voice_cache and self._cache_timestamp:
            if datetime.now() - self._cache_timestamp < timedelta(seconds=self.cache_ttl):
                return self._voice_cache

        try:
            response = self.session.get(f"{self.api_base}/voices")
            response.raise_for_status()
            data = response.json()

            voices = []
            for voice_data in data.get("voices", []):
                labels = voice_data.get("labels", {})
                voice = VoiceInfo(
                    voice_id=voice_data.get("voice_id"),
                    name=voice_data.get("name"),
                    category=voice_data.get("category"),
                    gender=labels.get("gender", "unknown"),
                    accent=labels.get("accent", "unknown"),
                    age=labels.get("age", "unknown"),
                    description=voice_data.get("description", ""),
                    preview_url=voice_data.get("preview_url", "")
                )
                voices.append(voice)

            self._voice_cache = voices
            self._cache_timestamp = datetime.now()
            return voices

        except requests.RequestException as e:
            logger.error(f"Failed to fetch voices from ElevenLabs: {e}")
            return []

    def get_voice(self, voice_id: str) -> Optional[VoiceInfo]:
        """Get details for a specific voice."""
        voices = self.list_voices()
        for voice in voices:
            if voice.voice_id == voice_id:
                return voice
        return None

    def text_to_speech(
        self,
        text: str,
        voice_id: str,
        model_id: str = "eleven_multilingual_v2",
        stability: float = 0.5,
        similarity_boost: float = 0.75,
        output_format: str = "mp3_44100_128",
        optimize_streaming_latency: int = 0,
    ) -> Tuple[bytes, Optional[str]]:
        """
        Convert text to speech using ElevenLabs API.

        Args:
            text: Text to convert to speech
            voice_id: ID of the voice to use
            model_id: Model to use (default: eleven_multilingual_v2)
            stability: Voice stability (0-1)
            similarity_boost: Similarity boost (0-1)
            output_format: Audio format (default: mp3_44100_128)
            optimize_streaming_latency: Latency optimization (0-4)

        Returns:
            Tuple of (audio_bytes, error_message)
            If successful, error_message is None
        """
        url = f"{self.api_base}/text-to-speech/{voice_id}"

        payload = {
            "text": text,
            "model_id": model_id,
            "voice_settings": {
                "stability": stability,
                "similarity_boost": similarity_boost
            }
        }

        params = {
            "output_format": output_format,
            "optimize_streaming_latency": optimize_streaming_latency
        }

        try:
            response = self.session.post(
                url,
                json=payload,
                params=params,
                headers=self._get_headers("application/json")
            )

            if response.status_code == 401:
                return None, "Invalid API key"
            elif response.status_code == 429:
                return None, "Rate limit exceeded. Please try again later."
            elif response.status_code == 422:
                return None, "Invalid request parameters"
            elif response.status_code >= 500:
                return None, "ElevenLabs service unavailable. Please try again."
            elif response.status_code != 200:
                return None, f"API error: {response.status_code}"

            return response.content, None

        except requests.RequestException as e:
            logger.error(f"Failed to generate speech: {e}")
            return None, f"Network error: {str(e)}"

    def create_voice_clone(
        self,
        name: str,
        audio_file: BinaryIO,
        description: str = ""
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        Create an instant voice clone from audio file.
        Requires paid plan (Starter or higher).

        Args:
            name: Name for the cloned voice
            audio_file: Audio file (binary)
            description: Optional description

        Returns:
            Tuple of (voice_id, error_message)
            If successful, error_message is None
        """
        url = f"{self.api_base}/voices/add"

        try:
            files = {
                "files": audio_file
            }
            data = {
                "name": name,
                "description": description
            }

            headers = {"xi-api-key": self.api_key}
            response = requests.post(
                url,
                files=files,
                data=data,
                headers=headers,
                timeout=60
            )

            if response.status_code == 401:
                return None, "Invalid API key"
            elif response.status_code == 422:
                error_data = response.json()
                error_msg = error_data.get("detail", {})
                if isinstance(error_msg, dict):
                    error_msg = error_msg.get("message", str(error_msg))
                return None, f"Invalid audio or parameters: {error_msg}"
            elif response.status_code >= 500:
                return None, "ElevenLabs service unavailable"
            elif response.status_code != 200:
                return None, f"API error: {response.status_code}"

            data = response.json()
            voice_id = data.get("voice_id")
            return voice_id, None

        except requests.RequestException as e:
            logger.error(f"Failed to create voice clone: {e}")
            return None, f"Network error: {str(e)}"
        except Exception as e:
            logger.error(f"Unexpected error in voice cloning: {e}")
            return None, str(e)

    def get_user_info(self) -> Tuple[Optional[Dict], Optional[str]]:
        """
        Get user account information including subscription tier and usage.
        """
        url = f"{self.api_base}/user"

        try:
            response = self.session.get(url)

            if response.status_code == 401:
                return None, "Invalid API key"
            elif response.status_code != 200:
                return None, f"API error: {response.status_code}"

            return response.json(), None

        except requests.RequestException as e:
            logger.error(f"Failed to get user info: {e}")
            return None, f"Network error: {str(e)}"

    def delete_voice(self, voice_id: str) -> Tuple[bool, Optional[str]]:
        """
        Delete a custom voice (only works for user-created voices).
        """
        url = f"{self.api_base}/voices/{voice_id}"

        try:
            response = self.session.delete(url)

            if response.status_code == 401:
                return False, "Invalid API key"
            elif response.status_code == 404:
                return False, "Voice not found"
            elif response.status_code != 200:
                return False, f"API error: {response.status_code}"

            return True, None

        except requests.RequestException as e:
            logger.error(f"Failed to delete voice: {e}")
            return False, f"Network error: {str(e)}"


# Singleton instance
_client: Optional[ElevenLabsClient] = None


def get_tts_client(config: Dict) -> Optional[ElevenLabsClient]:
    """
    Get or create ElevenLabs TTS client.
    Returns None if API key is not configured.
    """
    global _client

    if _client is not None:
        return _client

    tts_config = config.get("tts", {})
    elevenlabs_config = tts_config.get("elevenlabs", {})
    api_key = elevenlabs_config.get("api_key", "").strip()

    if not api_key:
        logger.warning("ElevenLabs API key not configured in config.yaml")
        return None

    api_base = elevenlabs_config.get("api_base", "https://api.elevenlabs.io/v1")
    _client = ElevenLabsClient(api_key, api_base)

    return _client


def init_tts_service(config: Dict) -> Optional[ElevenLabsClient]:
    """Initialize TTS service with configuration."""
    client = get_tts_client(config)
    if client:
        logger.info("ElevenLabs TTS service initialized successfully")
    return client
