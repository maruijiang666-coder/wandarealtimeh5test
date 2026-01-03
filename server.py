import asyncio
from importlib import reload
from typing import Awaitable, Callable
import json

import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
import uvicorn

from realtime_server.manager import Manager

from loguru import logger



app = FastAPI(title="live voice api")
manager = Manager()

# 文本请求模型
class TextRequest(BaseModel):
    model_type: str = "stepfun"
    sess_id: str
    text: str

@app.post("/text")
async def text_converse(request: TextRequest):
    """
    HTTP endpoint for text-only conversation.
    Accepts JSON with format: {'model_type': MODEL_TYPE, 
                              'sess_id': SESSION_ID, 
                              'text': TEXT_CONTENT}
    Returns responses as they arrive from the provider.
    """
    try:
        # 生成静音音频（1秒）
        import wave
        import struct
        import base64
        
        sample_rate = 16000
        duration = 1
        samples = [0] * (sample_rate * duration)  # 静音
        
        # 创建临时音频文件
        with wave.open('temp_silent.wav', 'wb') as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            packed_samples = struct.pack('h' * len(samples), *samples)
            wav_file.writeframes(packed_samples)
        
        # 转换为base64
        with open('temp_silent.wav', 'rb') as f:
            silent_audio = base64.b64encode(f.read()).decode('utf-8')
        
        # 获取提供商
        provider = manager.get_provider(request.model_type, request.sess_id)
        
        # 收集所有响应
        responses = []
        text_response = ""
        
        # 发送静音音频并获取响应
        async for result_chunk in provider.converse(silent_audio):
            responses.append(result_chunk)
            
            # 如果是文本响应，累积文本
            if result_chunk.get("type") == "response.text.delta":
                text_response += result_chunk.get("delta", "")
        
        return {
            "success": True,
            "text_response": text_response,
            "full_responses": responses
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws")
async def converse(ws:WebSocket):
    """
    WebSocket endpoint for real-time conversation.
    Expects JSON string with format: {'model_type': MODEL_TYPE, 
                                      'sess_id': SESSION_ID,   # put a new one to make a new connection
                                      'audio': ENCODED_AUDIO}
    Streams back responses as they arrive from the provider.
    """
    await ws.accept()
    try:
        while True:
            try:
                data = await ws.receive_text()
                data:dict = json.loads(data)
                audio_data = data.get("audio", "")
                audio_size = len(audio_data)
                # 简单判断是否为合法的 base64 字符串：长度是 4 的倍数且只包含合法字符
                is_valid_base64 = audio_size % 4 == 0 and all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=" for c in audio_data)
                # 准备音频预览
                audio_preview = audio_data[:50] + "..." if len(audio_data) > 50 else audio_data
                
                logger.debug({ 
                    "sess_id": data.get("sess_id"), 
                    "audio_size": audio_size, 
                    "valid_base64": is_valid_base64,
                    "audio": audio_preview,
                })
                provider = manager.get_provider(data.get("model_type"),
                                            data.get("sess_id"))
                
                # Stream results back to the client as they arrive
                async for result_chunk in provider.converse(data["audio"]):
                    # Send each chunk as JSON to the client
                    await ws.send_text(json.dumps(result_chunk))
                    
            except WebSocketDisconnect:
                # Client disconnected, exit gracefully
                break
            except KeyError as e:
                # Handle missing model_type or other key errors
                try:
                    await ws.send_text(json.dumps({
                        "type": "error",
                        "error": f"Missing required field: {e}"
                    }))
                except:
                    # If we can't send the error, connection is likely closed
                    break
            except Exception as e:
                # Handle any other errors
                try:
                    await ws.send_text(json.dumps({
                        "type": "error", 
                        "error": str(e)
                    }))
                except:
                    # If we can't send the error, connection is likely closed
                    break
    finally:
        # Release provider connection when client disconnects
        try:
            if 'provider' in locals():
                sess_id = data.get("sess_id")
                await manager.release_provider(sess_id)
        except Exception as e:
            print(f"Error releasing provider: {e}")
        
        # Only close if not already closed
        try:
            await ws.close()
        except:
            # Already closed, ignore
            pass


def main(host="0.0.0.0", port=8100):
    uvicorn.run("server:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()