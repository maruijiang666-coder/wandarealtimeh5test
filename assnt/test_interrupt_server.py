"""
Test interrupt functionality via WebSocket server.
Connects to server.py and tests interrupt behavior through the /ws endpoint.
"""
import asyncio
import json
import base64
from pathlib import Path
from datetime import datetime
import os
import wave
import uuid

try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False

import websockets


SERVER_URL = "ws://localhost:8100/ws"


def load_audio_file(file_path: str) -> str:
    """Load audio file and return base64 encoded bytes (raw file, not PCM).
    Server handles preprocessing (conversion to PCM, adding silence, chunking).
    """
    with open(file_path, "rb") as f:
        return base64.b64encode(f.read()).decode('utf-8')


def save_wav(audio_data: bytes, output_file: Path, sample_rate: int = 24000):
    with wave.open(str(output_file), 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sample_rate)
        f.writeframes(audio_data)


def extract_text(responses: list) -> str:
    parts = []
    for r in responses:
        if r.get("type") in ["response.text.delta", "response.audio_transcript.delta"]:
            t = r.get("delta", r.get("text", ""))
            if t:
                parts.append(t)
    return "".join(parts)


def extract_audio(responses: list) -> bytes:
    parts = []
    for r in responses:
        if r.get("type") == "response.audio.delta":
            a = r.get("delta", r.get("audio", ""))
            if a:
                parts.append(a)
    return base64.b64decode("".join(parts)) if parts else b""


async def test_interrupt_via_server():
    print("Testing Interrupt via WebSocket Server")
    print("=" * 60)
    
    if not PYDUB_AVAILABLE:
        print("pydub required!")
        return
    
    f1, f2 = "assets/my_name_is_tell_story.mp3", "assets/what_is_my_name.m4a"
    for f in [f1, f2]:
        if not Path(f).exists():
            print(f"Not found: {f}")
            return
    
    output_dir = Path("outputs")
    output_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Generate unique session ID
    sess_id = str(uuid.uuid4())
    model_type = "stepfun"
    
    print(f"Server: {SERVER_URL}")
    print(f"Session: {sess_id}")
    print(f"Model: {model_type}\n")
    
    # Load audio files (server handles preprocessing)
    print("Loading audio files...")
    a1 = load_audio_file(f1)
    a2 = load_audio_file(f2)
    print(f"  Audio 1: {len(a1)} bytes (base64)")
    print(f"  Audio 2: {len(a2)} bytes (base64)\n")
    
    all_resp, p1_resp, p2_resp = [], [], []
    interrupt_sent = False
    
    try:
        print("Connecting to server...")
        async with websockets.connect(SERVER_URL, ping_interval=30, ping_timeout=60) as ws:
            print("  Connected!\n")
            
            # Phase 1: Send first audio
            print("Phase 1: Sending my_name_is_tell_story...")
            msg1 = {
                "model_type": model_type,
                "sess_id": sess_id,
                "audio": a1
            }
            await ws.send(json.dumps(msg1))
            print("  Audio sent, waiting for response...")
            
            # Receive responses for phase 1
            try:
                while True:
                    try:
                        response = await asyncio.wait_for(ws.recv(), timeout=15.0)
                        r = json.loads(response)
                        all_resp.append({"phase": 1, "response": r})
                        p1_resp.append(r)
                        rt = r.get("type", "")
                        
                        if rt == "input_audio_buffer.speech_started":
                            print("  VAD: speech started")
                        elif rt == "input_audio_buffer.speech_stopped":
                            print("  VAD: speech stopped")
                        elif rt in ["response.text.delta", "response.audio_transcript.delta"]:
                            t = r.get("delta", "")
                            if t:
                                print(f"  [P1] {t}")
                        elif rt == "response.audio.delta":
                            print("  [P1] audio chunk")
                            # Send interrupt when model starts responding with audio
                            if not interrupt_sent:
                                print("\nPhase 2: INTERRUPT with what_is_my_name...")
                                msg2 = {
                                    "model_type": model_type,
                                    "sess_id": sess_id,
                                    "audio": a2
                                }
                                await ws.send(json.dumps(msg2))
                                interrupt_sent = True
                                print("  Interrupt audio sent!")
                        elif rt == "response.done":
                            print("  [P1] done")
                            break
                        elif rt == "response.cancelled":
                            print("  [P1] CANCELLED!")
                            break
                        elif rt == "error":
                            print(f"  Error: {r.get('error')}")
                            break
                    except asyncio.TimeoutError:
                        print("  Timeout waiting for P1 response")
                        break
            except Exception as e:
                print(f"  P1 error: {e}")
            
            print(f"  P1: {len(p1_resp)} responses")
            
            # Wait for interrupt response (Phase 2)
            if interrupt_sent:
                print("\nWaiting for interrupt response...")
                try:
                    while True:
                        try:
                            response = await asyncio.wait_for(ws.recv(), timeout=20.0)
                            r = json.loads(response)
                            all_resp.append({"phase": 2, "response": r})
                            p2_resp.append(r)
                            rt = r.get("type", "")
                            
                            if rt == "input_audio_buffer.speech_started":
                                print("  [P2] VAD: speech started")
                            elif rt == "input_audio_buffer.speech_stopped":
                                print("  [P2] VAD: speech stopped")
                            elif rt in ["response.text.delta", "response.audio_transcript.delta"]:
                                t = r.get("delta", "")
                                if t:
                                    print(f"  [P2] {t}")
                            elif rt == "response.audio.delta":
                                print("  [P2] audio chunk")
                            elif rt == "response.done":
                                print("  [P2] done")
                                break
                            elif rt == "error":
                                print(f"  Error: {r.get('error')}")
                                break
                        except asyncio.TimeoutError:
                            print("  Timeout waiting for P2 response")
                            break
                except Exception as e:
                    print(f"  P2 error: {e}")
                
                print(f"  P2: {len(p2_resp)} responses")
    
    except websockets.exceptions.ConnectionClosed as e:
        print(f"Connection closed: {e}")
    except ConnectionRefusedError:
        print(f"Could not connect to server at {SERVER_URL}")
        print("Make sure server.py is running: python server.py")
        return
    except Exception as e:
        print(f"Error: {e}")
    
    # Save results
    print("\nSaving...")
    with open(output_dir / f"interrupt_server_raw_{ts}.json", "w", encoding="utf-8") as f:
        json.dump(all_resp, f, indent=2, ensure_ascii=False)
    
    t1, t2 = extract_text(p1_resp), extract_text(p2_resp)
    with open(output_dir / f"interrupt_server_text_{ts}.txt", "w", encoding="utf-8") as f:
        f.write(f"=== P1 ===\n{t1 or '(none)'}\n\n=== P2 ===\n{t2 or '(none)'}\n")
    
    au1, au2 = extract_audio(p1_resp), extract_audio(p2_resp)
    if au1:
        save_wav(au1, output_dir / f"interrupt_server_p1_{ts}.wav")
        print(f"  P1 audio: {len(au1)} bytes")
    if au2:
        save_wav(au2, output_dir / f"interrupt_server_p2_{ts}.wav")
        print(f"  P2 audio: {len(au2)} bytes")
    
    print(f"\nSummary: P1={len(p1_resp)} P2={len(p2_resp)} interrupt={'Y' if interrupt_sent else 'N'}")
    if t1:
        print(f"  P1: {t1[:60]}...")
    if t2:
        print(f"  P2: {t2[:60]}...")
    
    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(test_interrupt_via_server())
