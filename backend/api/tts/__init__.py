from flask import Blueprint, request, jsonify, send_file
import io
import logging
from typing import Optional
from services.tts_service import get_tts_client, ElevenLabsClient

logger = logging.getLogger(__name__)

tts_bp = Blueprint('tts', __name__, url_prefix='/api/tts')

_tts_client: Optional[ElevenLabsClient] = None
_tts_config: dict = {}


def init_tts_routes(app, config):
    """Initialize TTS routes with config."""
    global _tts_client, _tts_config
    _tts_config = config
    _tts_client = get_tts_client(config)


@tts_bp.route('/voices', methods=['GET'])
def get_voices():
    """Get list of available voices."""
    custom_api_token = request.args.get('api_token')
    tts_client = get_tts_client(_tts_config, custom_api_token)
    
    if not tts_client:
        return jsonify({"error": "TTS service not configured"}), 503

    voices = tts_client.list_voices(use_cache=True)
    
    return jsonify({
        "voices": [
            {
                "voice_id": v.voice_id,
                "name": v.name,
                "category": v.category,
                "gender": v.gender,
                "accent": v.accent,
                "age": v.age,
                "description": v.description,
                "preview_url": v.preview_url
            }
            for v in voices
        ]
    })


@tts_bp.route('/voices/<voice_id>', methods=['GET'])
def get_voice_details(voice_id: str):
    """Get details for a specific voice."""
    if not _tts_client:
        return jsonify({"error": "TTS service not configured"}), 503

    voice = _tts_client.get_voice(voice_id)
    
    if not voice:
        return jsonify({"error": "Voice not found"}), 404
    
    return jsonify({
        "voice_id": voice.voice_id,
        "name": voice.name,
        "category": voice.category,
        "gender": voice.gender,
        "accent": voice.accent,
        "age": voice.age,
        "description": voice.description,
        "preview_url": voice.preview_url
    })


@tts_bp.route('/speak', methods=['POST'])
def speak():
    """Convert text to speech."""
    data = request.get_json()
    
    if not data or "text" not in data:
        return jsonify({"error": "Missing 'text' parameter"}), 400
    
    if "voice_id" not in data:
        return jsonify({"error": "Missing 'voice_id' parameter"}), 400

    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "Text cannot be empty"}), 400
    
    if len(text) > 5000:
        return jsonify({"error": "Text too long (max 5000 characters)"}), 400

    custom_api_token = data.get("api_token")
    tts_client = get_tts_client(_tts_config, custom_api_token)
    
    if not tts_client:
        return jsonify({"error": "TTS service not configured"}), 503

    voice_id = data.get("voice_id")
    model_id = data.get("model_id", "eleven_multilingual_v2")
    stability = float(data.get("stability", 0.5))
    similarity_boost = float(data.get("similarity_boost", 0.75))
    output_format = data.get("output_format", "mp3_44100_128")
    optimize_streaming_latency = int(data.get("optimize_streaming_latency", 0))

    audio_bytes, error = tts_client.text_to_speech(
        text=text,
        voice_id=voice_id,
        model_id=model_id,
        stability=stability,
        similarity_boost=similarity_boost,
        output_format=output_format,
        optimize_streaming_latency=optimize_streaming_latency
    )

    if error:
        return jsonify({"error": error}), 400

    audio_stream = io.BytesIO(audio_bytes)
    return send_file(
        audio_stream,
        mimetype="audio/mpeg",
        as_attachment=False,
        download_name="speech.mp3"
    )


@tts_bp.route('/upload-voice', methods=['POST'])
def upload_custom_voice():
    """Upload and create a custom voice clone."""
    custom_api_token = request.form.get('api_token')
    tts_client = get_tts_client(_tts_config, custom_api_token)
    
    if not tts_client:
        return jsonify({"error": "TTS service not configured"}), 503

    if "file" not in request.files:
        return jsonify({"error": "Missing audio file"}), 400

    if "name" not in request.form:
        return jsonify({"error": "Missing 'name' parameter"}), 400

    audio_file = request.files["file"]
    voice_name = request.form.get("name", "").strip()
    description = request.form.get("description", "")

    if not voice_name:
        return jsonify({"error": "Voice name cannot be empty"}), 400

    if not audio_file.filename or audio_file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    allowed_extensions = {"mp3", "wav", "m4a", "webm"}
    filename = audio_file.filename or ""
    file_ext = filename.rsplit(".", 1)[1].lower() if "." in filename else ""
    
    if file_ext not in allowed_extensions:
        return jsonify({"error": f"Unsupported audio format. Allowed: {', '.join(allowed_extensions)}"}), 400

    try:
        voice_id, error = tts_client.create_voice_clone(
            name=voice_name,
            audio_file=audio_file.stream,
            description=description
        )

        if error:
            return jsonify({"error": error}), 400

        return jsonify({
            "voice_id": voice_id,
            "name": voice_name,
            "message": "Voice clone created successfully"
        }), 201

    except Exception as e:
        logger.error(f"Error uploading voice: {e}")
        return jsonify({"error": f"Failed to upload voice: {str(e)}"}), 500


@tts_bp.route('/delete-voice/<voice_id>', methods=['DELETE'])
def delete_custom_voice(voice_id: str):
    """Delete a custom voice clone."""
    custom_api_token = request.args.get('api_token') or request.get_json().get('api_token') if request.is_json else None
    tts_client = get_tts_client(_tts_config, custom_api_token)
    
    if not tts_client:
        return jsonify({"error": "TTS service not configured"}), 503

    success, error = tts_client.delete_voice(voice_id)

    if not success:
        return jsonify({"error": error}), 400

    return jsonify({"message": "Voice deleted successfully"})


@tts_bp.route('/user-info', methods=['GET'])
def get_user_info():
    """Get ElevenLabs user account information."""
    custom_api_token = request.args.get('api_token')
    tts_client = get_tts_client(_tts_config, custom_api_token)
    
    if not tts_client:
        return jsonify({"error": "TTS service not configured"}), 503

    user_info, error = tts_client.get_user_info()

    if error:
        return jsonify({"error": error}), 400

    return jsonify(user_info)
