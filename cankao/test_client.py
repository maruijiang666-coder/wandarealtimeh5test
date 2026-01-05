"""
Test client for the realtime server.
Sends audio to the server and saves both text and audio outputs.
"""
import asyncio
import json
import base64
import websockets
from pathlib import Path
from datetime import datetime
import argparse
import wave
import struct

# Try to import pydub for MP3 support (optional)
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False


def save_audio_as_wav(audio_data: bytes, output_file: Path, sample_rate: int = 24000, 
                       num_channels: int = 1, sample_width: int = 2):
    """
    Save raw audio data as a WAV file.
    
    Args:
        audio_data: Raw audio bytes
        output_file: Output file path
        sample_rate: Sample rate in Hz (default: 24000)
        num_channels: Number of channels (default: 1 for mono)
        sample_width: Sample width in bytes (default: 2 for 16-bit)
    """
    with wave.open(str(output_file), 'wb') as wav_file:
        wav_file.setnchannels(num_channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(audio_data)


def save_audio_as_mp3(audio_data: bytes, output_file: Path, sample_rate: int = 24000,
                       num_channels: int = 1, sample_width: int = 2):
    """
    Save raw audio data as an MP3 file using pydub.
    
    Args:
        audio_data: Raw audio bytes
        output_file: Output file path
        sample_rate: Sample rate in Hz (default: 24000)
        num_channels: Number of channels (default: 1 for mono)
        sample_width: Sample width in bytes (default: 2 for 16-bit)
    
    Returns:
        True if successful, False otherwise
    """
    if not PYDUB_AVAILABLE:
        return False
    
    try:
        # Create AudioSegment from raw data
        audio = AudioSegment(
            data=audio_data,
            sample_width=sample_width,
            frame_rate=sample_rate,
            channels=num_channels
        )
        # Export as MP3
        audio.export(str(output_file), format="mp3", bitrate="192k")
        return True
    except Exception as e:
        print(f"  Failed to save as MP3: {e}")
        return False


def detect_audio_format(audio_data: bytes) -> str:
    """
    Try to detect the audio format from the data.
    
    Returns:
        Format string: 'wav', 'mp3', 'opus', or 'raw'
    """
    if len(audio_data) < 12:
        return 'raw'
    
    # Check for WAV header (RIFF)
    if audio_data[:4] == b'RIFF' and audio_data[8:12] == b'WAVE':
        return 'wav'
    
    # Check for MP3 header (ID3 or sync word)
    if audio_data[:3] == b'ID3' or (audio_data[0] == 0xFF and (audio_data[1] & 0xE0) == 0xE0):
        return 'mp3'
    
    # Check for Ogg/Opus header
    if audio_data[:4] == b'OggS':
        return 'opus'
    
    return 'raw'


async def test_realtime_server(
    server_url: str = "ws://6.6.6.190:8100/ws",
    audio_file: str = None,
    model_type: str = "stepfun",
    output_dir: str = "outputs",
    audio_format: str = "auto",
    sample_rate: int = 24000,
    channels: int = 1
):
    """
    Test the realtime server by sending audio and receiving responses.
    
    Args:
        server_url: WebSocket URL of the server
        audio_file: Path to audio file to send (if None, sends a test payload)
        model_type: Model type to use (e.g., 'stepfun')
        output_dir: Directory to save outputs
        audio_format: Output audio format ('auto', 'wav', 'mp3', 'raw')
        sample_rate: Sample rate for audio (default: 24000 Hz)
        channels: Number of audio channels (default: 1 for mono)
    """
    # Create output directory if it doesn't exist
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    # Generate timestamp for unique filenames
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Prepare audio data
    if audio_file:
        print(f"Loading audio from {audio_file}")
        with open(audio_file, "rb") as f:
            audio_bytes = f.read()
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
    else:
        print("No audio file provided, using test payload")
        # Create a simple test audio payload (empty for now)
        audio_base64 = base64.b64encode(b"test_audio_data").decode('utf-8')
    
    # Prepare the payload
    payload = {
        "model_type": model_type,
        "sess_id": "20",
        "audio": audio_base64
    }
    
    # Connect to the server
    print(f"Connecting to {server_url}...")
    try:
        async with websockets.connect(server_url) as websocket:
            print("Connected successfully!")
            
            # Send the payload
            print("Sending payload...")
            await websocket.send(json.dumps(payload))
            print("Payload sent, waiting for responses...")
            
            # Collect responses
            text_responses = []
            audio_chunks = []
            response_count = 0
            
            try:
                async for message in websocket:
                    response_count += 1
                    print(f"Received response #{response_count}")
                    
                    try:
                        data = json.loads(message)
                        
                        # Print the response type
                        response_type = data.get("type", "unknown")
                        print(f"  Type: {response_type}")
                        
                        # Handle different response types
                        if response_type == "response.text.delta" or response_type == "response.audio_transcript.delta":
                            # Text response or audio transcript
                            text_content = data.get("delta", data.get("text", ""))
                            if text_content:
                                text_responses.append(text_content)
                                print(f"  Text: {text_content}")
                        
                        elif response_type == "response.audio.delta":
                            # Audio response
                            audio_content = data.get("delta", data.get("audio", ""))
                            if audio_content:
                                audio_chunks.append(audio_content)
                                print(f"  Audio chunk received (length: {len(audio_content)})")
                        
                        elif response_type == "response.done":
                            print("  Response complete!")
                            break
                        
                        elif response_type == "error":
                            error_msg = data.get("error", "Unknown error")
                            print(f"  ERROR: {error_msg}")
                            if "raw" in data:
                                print(f"  Raw data: {data['raw']}")
                        
                        else:
                            # Unknown type, print the whole response
                            print(f"  Data: {json.dumps(data, indent=2)}")
                        
                        # Save raw response
                        with open(output_path / f"raw_response_{timestamp}.jsonl", "a") as f:
                            f.write(json.dumps(data) + "\n")
                    
                    except json.JSONDecodeError as e:
                        print(f"  Failed to parse JSON: {e}")
                        print(f"  Raw message: {message}")
                        with open(output_path / f"raw_response_{timestamp}.jsonl", "a") as f:
                            f.write(f"PARSE_ERROR: {message}\n")
            
            except websockets.exceptions.ConnectionClosed:
                print("Connection closed by server")
            
            # Save text responses
            if text_responses:
                text_output_file = output_path / f"text_response_{timestamp}.txt"
                combined_text = "".join(text_responses)
                with open(text_output_file, "w") as f:
                    f.write(combined_text)
                print(f"\n✅ Text responses saved to: {text_output_file}")
                print(f"Total text length: {len(combined_text)} characters")
            else:
                print("\n⚠️  No text responses received")
            
            # Save audio responses
            if audio_chunks:
                # Combine all audio chunks
                combined_audio_base64 = "".join(audio_chunks)
                
                # Decode audio data
                try:
                    audio_binary = base64.b64decode(combined_audio_base64)
                    print(f"\n✅ Decoded audio: {len(audio_binary)} bytes")
                    
                    # Detect or use specified format
                    if audio_format == "auto":
                        detected_format = detect_audio_format(audio_binary)
                        print(f"   Detected format: {detected_format}")
                        output_format = detected_format
                    else:
                        output_format = audio_format
                    
                    # Save audio in appropriate format
                    audio_saved = False
                    
                    if output_format == "wav" or (output_format == "raw" and audio_format == "auto"):
                        # Save as WAV (works for raw PCM data)
                        try:
                            wav_file = output_path / f"audio_response_{timestamp}.wav"
                            save_audio_as_wav(audio_binary, wav_file, sample_rate, channels)
                            print(f"✅ Audio saved as WAV: {wav_file}")
                            audio_saved = True
                        except Exception as e:
                            print(f"⚠️  Failed to save as WAV: {e}")
                    
                    if output_format == "mp3" or (not audio_saved and audio_format == "auto" and PYDUB_AVAILABLE):
                        # Try to save as MP3
                        mp3_file = output_path / f"audio_response_{timestamp}.mp3"
                        if save_audio_as_mp3(audio_binary, mp3_file, sample_rate, channels):
                            print(f"✅ Audio saved as MP3: {mp3_file}")
                            audio_saved = True
                    
                    if output_format in ["mp3", "wav", "opus"] and detect_audio_format(audio_binary) == output_format:
                        # Audio is already in the target format, save directly
                        ext = output_format
                        audio_file = output_path / f"audio_response_{timestamp}.{ext}"
                        with open(audio_file, "wb") as f:
                            f.write(audio_binary)
                        print(f"✅ Audio saved as {ext.upper()}: {audio_file}")
                        audio_saved = True
                    
                    # Always save raw as backup
                    if not audio_saved or output_format == "raw":
                        raw_file = output_path / f"audio_response_{timestamp}.raw"
                        with open(raw_file, "wb") as f:
                            f.write(audio_binary)
                        print(f"✅ Audio saved as raw PCM: {raw_file}")
                    
                    # Optionally save base64 version
                    if output_format == "raw" or not audio_saved:
                        base64_file = output_path / f"audio_response_{timestamp}.base64"
                        with open(base64_file, "w") as f:
                            f.write(combined_audio_base64)
                        print(f"   Base64 version: {base64_file}")
                    
                    print(f"   Audio format: {output_format}")
                    print(f"   Sample rate: {sample_rate} Hz")
                    print(f"   Channels: {channels}")
                    print(f"   Size: {len(audio_binary)} bytes")
                    
                except Exception as e:
                    print(f"\n⚠️  Failed to process audio: {e}")
                    import traceback
                    traceback.print_exc()
            else:
                print("\n⚠️  No audio responses received")
            
            print(f"\n📊 Summary:")
            print(f"   Total responses: {response_count}")
            print(f"   Text chunks: {len(text_responses)}")
            print(f"   Audio chunks: {len(audio_chunks)}")
    
    except ConnectionRefusedError:
        print(f"❌ Failed to connect to {server_url}")
        print("   Make sure the server is running!")
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()


def main():
    parser = argparse.ArgumentParser(description="Test the realtime server")
    parser.add_argument(
        "--url",
        default="ws://6.6.6.190:8100/ws",
        # default="ws://127.0.0.1:8100/ws",
        help="WebSocket URL of the server (default: ws://localhost:8100/ws)"
    )
    parser.add_argument(
        "--audio",
        help="Path to audio file to send (optional)",
        default="assets/my_name_is.m4a"
    )
    parser.add_argument(
        "--model",
        default="stepfun",
        help="Model type to use (default: stepfun)"
    )
    parser.add_argument(
        "--output-dir",
        default="outputs",
        help="Directory to save outputs (default: outputs)"
    )
    parser.add_argument(
        "--audio-format",
        default="auto",
        choices=["auto", "wav", "mp3", "raw"],
        help="Output audio format (default: auto)"
    )
    parser.add_argument(
        "--sample-rate",
        type=int,
        default=24000,
        help="Audio sample rate in Hz (default: 24000)"
    )
    parser.add_argument(
        "--channels",
        type=int,
        default=1,
        help="Number of audio channels (default: 1)"
    )
    
    args = parser.parse_args()
    
    # Show pydub availability for MP3 support
    if args.audio_format == "mp3" and not PYDUB_AVAILABLE:
        print("⚠️  Warning: pydub not installed, MP3 output not available")
        print("   Install with: pip install pydub")
        print("   Also requires ffmpeg: https://ffmpeg.org/download.html")
        print()
    
    print("=" * 60)
    print("Realtime Server Test Client")
    print("=" * 60)
    print(f"Server URL: {args.url}")
    print(f"Model: {args.model}")
    print(f"Audio file: {args.audio or 'None (using test payload)'}")
    print(f"Output directory: {args.output_dir}")
    print(f"Audio format: {args.audio_format}")
    print(f"Sample rate: {args.sample_rate} Hz")
    print(f"Channels: {args.channels}")
    print("=" * 60)
    print()
    
    asyncio.run(test_realtime_server(
        server_url=args.url,
        audio_file=args.audio,
        model_type=args.model,
        output_dir=args.output_dir,
        audio_format=args.audio_format,
        sample_rate=args.sample_rate,
        channels=args.channels
    ))


if __name__ == "__main__":
    main()


