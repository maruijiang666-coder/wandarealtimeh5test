class RealtimeClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.sessId = null;
    
    // 响应数据收集
    this.currentTextResponse = '';
    this.currentAudioChunks = [];
    this.currentTranscript = '';
    this.isRecording = false;
    
    // 录音相关
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioChunks = [];
    
    // 持续录音相关
    this.isContinuousRecording = false;
    this.continuousStream = null;
    this.continuousMediaRecorder = null;
    this.continuousAudioChunks = [];
    this.continuousInterval = null;
    
    // 获取元素
    this.statusEl = document.getElementById('status');
    this.responseBox = document.getElementById('responseBox');
    this.connectBtn = document.getElementById('connectBtn');
    this.disconnectBtn = document.getElementById('disconnectBtn');
    this.uploadBtn = document.getElementById('uploadBtn');
    this.recordBtn = document.getElementById('recordBtn');
    this.continuousRecordBtn = document.getElementById('continuousRecordBtn');
    this.testBtn = document.getElementById('testBtn');
    this.fileInput = document.getElementById('fileInput');
    
    // 绑定事件
    this.connectBtn.onclick = () => this.connect();
    this.disconnectBtn.onclick = () => this.disconnect();
    this.uploadBtn.onclick = () => this.fileInput.click();
    this.recordBtn.onclick = () => this.toggleRecording();
    this.continuousRecordBtn.onclick = () => this.toggleContinuousRecording();
    this.testBtn.onclick = () => this.testConnection();
    this.fileInput.onchange = (e) => {
      if (e.target.files[0]) {
        this.sendAudio(e.target.files[0]);
      }
    };
  }
  
  async toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }
  
  async startRecording() {
    try {
      this.log('🎤 请求麦克风权限...', 'system');
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 48000
        } 
      });
      
      this.log('✓ 麦克风权限已获取', 'system');
      
      // 尝试使用 MP3 格式，如果不支持则降级
      let mimeType = '';
      const formats = [
        'audio/mpeg',      // MP3
        'audio/mp4',       // M4A
        'audio/webm',      // WebM
        'audio/ogg'        // OGG
      ];
      
      for (const format of formats) {
        if (MediaRecorder.isTypeSupported(format)) {
          mimeType = format;
          this.log(`✓ 使用格式: ${format}`, 'system');
          break;
        }
      }
      
      if (!mimeType) {
        this.log('⚠️ 使用浏览器默认格式', 'system');
      }
      
      const options = mimeType ? { mimeType } : {};
      this.mediaRecorder = new MediaRecorder(stream, options);
      this.audioChunks = [];
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
      
      this.mediaRecorder.onstop = () => {
        this.processRecording();
      };
      
      this.mediaRecorder.start();
      this.isRecording = true;
      
      this.recordBtn.classList.add('recording');
      this.recordBtn.textContent = '⏹️ 停止录音';
      
      this.log('🔴 录音中...', 'system');
      
    } catch (error) {
      console.error('录音失败:', error);
      this.log('❌ 无法访问麦克风: ' + error.message, 'error');
    }
  }
  
  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      
      this.isRecording = false;
      this.recordBtn.classList.remove('recording');
      this.recordBtn.textContent = '🎤 开始录音';
      
      this.log('⏹️ 录音已停止，正在处理...', 'system');
    }
  }
  
  async processRecording() {
    try {
      // 合并音频块
      const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
      
      this.log(`📦 录音大小: ${audioBlob.size} 字节`, 'system');
      this.log(`📦 格式: ${audioBlob.type}`, 'system');
      
      // 直接转换为 ArrayBuffer（不做任何处理）
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // 直接转换为 Base64（不做任何处理）
      const base64 = this.arrayBufferToBase64(arrayBuffer);
      
      console.log('录音信息:');
      console.log('- 格式:', audioBlob.type);
      console.log('- 大小:', audioBlob.size, '字节');
      console.log('- Base64 长度:', base64.length, '字符');
      
      this.log(`📤 发送录音 (${audioBlob.size} 字节)...`, 'system');
      
      // 发送到后端
      const message = {
        model_type: 'stepfun',
        sess_id: this.sessId,
        audio: base64
      };
      
      this.ws.send(JSON.stringify(message));
      
      this.log('✓ 录音已发送，等待响应...', 'system');
      
      // 设置超时检测
      this.responseTimeout = setTimeout(() => {
        this.log('⚠️ 30秒内未收到响应', 'error');
      }, 30000);
      
    } catch (error) {
      console.error('处理录音失败:', error);
      this.log('❌ 处理失败: ' + error.message, 'error');
    }
  }
  
  testConnection() {
    this.log('🧪 测试 WebSocket 连接...', 'system');
    console.log('WebSocket 状态:', this.ws.readyState);
    console.log('0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED');
    
    if (this.ws.readyState === 1) {
      this.log('✓ WebSocket 状态: OPEN (正常)', 'system');
      
      // 发送一个测试消息
      const testMsg = {
        model_type: 'stepfun',
        sess_id: this.sessId,
        audio: 'dGVzdA==' // "test" 的 base64
      };
      
      this.log('📤 发送测试消息...', 'system');
      this.ws.send(JSON.stringify(testMsg));
      this.log('✓ 测试消息已发送，等待响应...', 'system');
    } else {
      this.log('❌ WebSocket 状态异常: ' + this.ws.readyState, 'error');
    }
  }
  
  connect() {
    this.log('正在连接到后端...', 'system');
    
    // const wsUrl = 'ws://6.6.6.190:8100/ws';

  // python 本地环境用
    const wsUrl = 'ws://127.0.0.1:8100/ws';

    console.log('创建 WebSocket 连接:', wsUrl);
    
    this.ws = new WebSocket(wsUrl);
    
    // 添加连接标识
    this.wsId = 'ws_' + Date.now();
    console.log('WebSocket ID:', this.wsId);
    
    this.ws.onopen = () => {
      console.log('[' + this.wsId + '] WebSocket 已打开');
      
      this.isConnected = true;
      this.sessId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      
      this.statusEl.textContent = '状态: 已连接 | 会话ID: ' + this.sessId;
      this.statusEl.classList.add('connected');
      
      this.connectBtn.disabled = true;
      this.disconnectBtn.disabled = false;
      this.uploadBtn.disabled = false;
      this.recordBtn.disabled = false;
      this.continuousRecordBtn.disabled = false;
      this.testBtn.disabled = false;
      
      console.log('会话ID:', this.sessId);
      console.log('WebSocket 对象:', this.ws);
      
      this.log('✓ 连接成功！会话ID: ' + this.sessId, 'system');
    };
    
    this.ws.onmessage = (event) => {
      console.log('[' + this.wsId + '] 收到消息');
      console.log('[原始消息]', event.data);
      try {
        const data = JSON.parse(event.data);
        console.log('[解析后]', data);
        this.handleResponse(data);
      } catch (error) {
        console.error('解析响应失败:', error, '原始数据:', event.data);
        this.log('解析响应失败: ' + error.message, 'error');
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('[' + this.wsId + '] WebSocket 错误:', error);
      this.log('连接错误', 'error');
    };
    
    this.ws.onclose = () => {
      console.log('[' + this.wsId + '] WebSocket 已关闭');
      this.disconnect();
    };
  }
  
  disconnect() {
    this.isConnected = false;
    this.sessId = null;
    
    this.statusEl.textContent = '状态: 未连接';
    this.statusEl.classList.remove('connected');
    
    this.connectBtn.disabled = false;
    this.disconnectBtn.disabled = true;
    this.uploadBtn.disabled = true;
    this.recordBtn.disabled = true;
    this.continuousRecordBtn.disabled = true;
    this.testBtn.disabled = true;
    
    // 停止持续录音
    if (this.isContinuousRecording) {
      this.stopContinuousRecording();
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.log('连接已断开', 'system');
  }
  
  async sendAudio(file) {
    if (!this.isConnected) {
      this.log('请先连接到服务器', 'error');
      return;
    }
    
    this.log(`📁 正在处理文件: ${file.name} (${file.type})`, 'system');
    
    try {
      // 直接读取文件为 ArrayBuffer，不做任何处理
      // 后端会负责音频预处理（转换、添加静音、分块等）
      const arrayBuffer = await file.arrayBuffer();
      
      // 转换为 Base64
      const base64 = this.arrayBufferToBase64(arrayBuffer);
      
      console.log('文件信息:');
      console.log('- 文件名:', file.name);
      console.log('- 文件类型:', file.type);
      console.log('- 文件大小:', file.size, '字节');
      console.log('- Base64 长度:', base64.length, '字符');
      console.log('- Base64 前50字符:', base64.substring(0, 50));
      
      // 验证 base64 格式
      if (base64.length % 4 !== 0) {
        this.log('⚠️ Base64 长度不是4的倍数', 'error');
      }
      
      this.log(`📤 发送原始音频文件 (${file.size} 字节)...`, 'system');
      this.log('ℹ️ 后端将处理音频格式转换', 'system');
      
      // 发送到后端
      const message = {
        model_type: 'stepfun',
        sess_id: this.sessId,
        audio: base64
      };
      
      console.log('发送消息:', {
        model_type: message.model_type,
        sess_id: message.sess_id,
        audio_length: message.audio.length,
        audio_preview: message.audio.substring(0, 50) + '...'
      });
      
      console.log('[' + this.wsId + '] 准备发送音频');
      console.log('WebSocket 状态:', this.ws.readyState, '(1=OPEN)');
      console.log('完整消息 JSON 长度:', JSON.stringify(message).length, '字节');
      
      try {
        this.ws.send(JSON.stringify(message));
        console.log('[' + this.wsId + '] ✓ WebSocket.send() 调用成功');
      } catch (sendError) {
        console.error('[' + this.wsId + '] ❌ WebSocket.send() 失败:', sendError);
        this.log('❌ 发送失败: ' + sendError.message, 'error');
        return;
      }
      
      this.log('✓ 音频已发送，等待后端处理和响应...', 'system');
      this.log('⏱️ 如果30秒内没有响应，可能是后端处理出错', 'system');
      
      // 设置超时检测
      this.responseTimeout = setTimeout(() => {
        this.log('⚠️ 30秒内未收到响应，可能的原因：', 'error');
        this.log('  1. 后端处理音频时出错', 'error');
        this.log('  2. 音频文件格式不支持', 'error');
        this.log('  3. StepFun API 连接问题', 'error');
        this.log('💡 请检查后端日志获取详细错误信息', 'system');
      }, 30000);
      
      // 清空文件选择
      this.fileInput.value = '';
      
    } catch (error) {
      console.error('处理文件失败:', error);
      this.log('❌ 处理失败: ' + error.message, 'error');
    }
  }
  
  handleResponse(data) {
    console.log('[响应]', data.type, data);
    
    // 清除超时检测
    if (this.responseTimeout) {
      clearTimeout(this.responseTimeout);
      this.responseTimeout = null;
    }
    
    // 处理错误
    if (data.type === 'error') {
      const errorMsg = data.error?.message || data.error || JSON.stringify(data);
      this.log('❌ 错误: ' + errorMsg, 'error');
      return;
    }
    
    // 根据事件类型处理
    switch (data.type) {
      // === 会话事件 ===
      case 'session.created':
        this.log('✓ StepFun 会话已创建', 'system');
        break;
        
      case 'session.updated':
        this.log('✓ 会话配置已更新', 'system');
        break;
      
      // === 对话项事件 ===
      case 'conversation.item.created':
        this.log('📝 对话项已创建', 'system');
        break;
      
      // === 响应生命周期事件 ===
      case 'response.created':
        this.log('🤖 AI 开始响应...', 'system');
        this.currentTextResponse = '';
        this.currentAudioChunks = [];
        this.currentTranscript = '';
        break;
        
      case 'response.output_item.added':
        this.log('📤 输出项已添加', 'system');
        break;
        
      case 'response.content_part.added':
        this.log('📄 内容部分已添加', 'system');
        break;
      
      // === 文本响应事件 ===
      case 'response.text.delta':
        // 累积文本增量
        this.currentTextResponse += data.delta;
        this.updateTextDisplay(this.currentTextResponse);
        break;
        
      case 'response.text.done':
        this.log('✓ 文本生成完成', 'system');
        this.log('📝 完整文本: ' + data.text, 'text');
        break;
      
      // === 音频响应事件 ===
      case 'response.audio.delta':
        // 收集音频块
        this.currentAudioChunks.push(data.delta);
        this.log('🔊 收到音频块 (' + this.currentAudioChunks.length + ')', 'system');
        break;
        
      case 'response.audio.done':
        this.log('✓ 音频生成完成 (共 ' + this.currentAudioChunks.length + ' 块)', 'system');
        if (this.currentAudioChunks.length > 0) {
          this.playAudio(this.currentAudioChunks);
        }
        break;
      
      // === 音频转录事件 ===
      case 'response.audio_transcript.delta':
        this.currentTranscript += data.delta;
        this.log('📝 转录: ' + this.currentTranscript, 'transcript');
        break;
        
      case 'response.audio_transcript.done':
        this.log('✓ 转录完成: ' + data.transcript, 'transcript');
        break;
      
      // === 响应完成事件 ===
      case 'response.content_part.done':
        this.log('✓ 内容部分完成', 'system');
        break;
        
      case 'response.output_item.done':
        this.log('✓ 输出项完成', 'system');
        break;
        
      case 'response.done':
        this.log('✅ 响应完全完成', 'system');
        this.log('─────────────────────', 'system');
        break;
      
      // === 输入音频缓冲区事件 ===
      case 'input_audio_buffer.speech_started':
        this.log('🎤 检测到语音开始', 'system');
        break;
        
      case 'input_audio_buffer.speech_stopped':
        this.log('🎤 检测到语音结束', 'system');
        break;
        
      case 'input_audio_buffer.committed':
        this.log('✓ 音频缓冲区已提交', 'system');
        break;
      
      // === 速率限制事件 ===
      case 'rate_limits.updated':
        console.log('速率限制:', data.rate_limits);
        break;
      
      // === 其他事件 ===
      default:
        this.log(`[${data.type}] ${JSON.stringify(data)}`, 'response');
    }
  }
  
  updateTextDisplay(text) {
    // 更新或创建文本显示区域
    let textDisplay = document.getElementById('currentText');
    if (!textDisplay) {
      textDisplay = document.createElement('div');
      textDisplay.id = 'currentText';
      textDisplay.className = 'message text-stream';
      this.responseBox.appendChild(textDisplay);
    }
    textDisplay.textContent = '💬 ' + text;
    this.responseBox.scrollTop = this.responseBox.scrollHeight;
  }
  
  async playAudio(base64Chunks) {
    if (!base64Chunks || base64Chunks.length === 0) return;
    
    this.log('🔊 开始播放音频...', 'system');
    
    try {
      // 创建音频上下文 (24000Hz 是 StepFun 的输出采样率)
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 24000
      });
      
      // 合并所有 base64 音频块
      let totalLength = 0;
      const buffers = base64Chunks.map(base64 => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        totalLength += bytes.length;
        return bytes;
      });
      
      // 合并所有字节
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      buffers.forEach(buffer => {
        combined.set(buffer, offset);
        offset += buffer.length;
      });
      
      // 转换 PCM16 为 Float32
      const float32 = new Float32Array(combined.length / 2);
      const view = new DataView(combined.buffer);
      
      for (let i = 0; i < float32.length; i++) {
        const int16 = view.getInt16(i * 2, true);
        float32[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
      }
      
      // 创建音频缓冲区
      const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      
      // 播放
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();
      
      source.onended = () => {
        this.log('✓ 音频播放完成', 'system');
      };
      
    } catch (error) {
      console.error('播放音频失败:', error);
      this.log('❌ 播放失败: ' + error.message, 'error');
    }
  }
  
  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    
    return btoa(binary);
  }
  
  log(message, type = 'system') {
    const div = document.createElement('div');
    div.className = 'message ' + type;
    
    // 添加时间戳
    const time = new Date().toLocaleTimeString('zh-CN', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    
    div.innerHTML = `<span class="time">[${time}]</span> ${this.escapeHtml(message)}`;
    
    this.responseBox.appendChild(div);
    this.responseBox.scrollTop = this.responseBox.scrollHeight;
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // 持续录音功能
  async toggleContinuousRecording() {
    if (this.isContinuousRecording) {
      this.stopContinuousRecording();
    } else {
      this.startContinuousRecording();
    }
  }
  
  async startContinuousRecording() {
    if (!this.isConnected) {
      this.log('请先连接到服务器', 'error');
      return;
    }
    
    try {
      this.log('🎤 启动持续录音模式...', 'system');
      
      this.continuousStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 48000
        } 
      });
      
      this.log('✓ 麦克风权限已获取', 'system');
      
      // 使用支持的音频格式
      let mimeType = '';
      const formats = ['audio/webm', 'audio/ogg', 'audio/mp4'];
      
      for (const format of formats) {
        if (MediaRecorder.isTypeSupported(format)) {
          mimeType = format;
          this.log(`✓ 使用格式: ${format}`, 'system');
          break;
        }
      }
      
      const options = mimeType ? { mimeType } : {};
      this.continuousMediaRecorder = new MediaRecorder(this.continuousStream, options);
      
      this.isContinuousRecording = true;
      this.continuousRecordBtn.classList.add('recording');
      this.continuousRecordBtn.textContent = '⏹️ 停止持续录音';
      
      // 持续收集音频数据
      this.continuousAudioChunks = [];
      
      this.continuousMediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.continuousAudioChunks.push(event.data);
        }
      };
      
      // 启动录音，持续收集数据
      this.continuousMediaRecorder.start();
      
      // 每50ms发送这段时间内收集到的所有音频数据
      this.continuousInterval = setInterval(async () => {
        if (this.continuousAudioChunks.length > 0) {
          // 合并这段时间内收集到的所有音频块
          const audioBlob = new Blob(this.continuousAudioChunks, { type: this.continuousMediaRecorder.mimeType });
          this.continuousAudioChunks = []; // 清空已发送的数据
          
          if (audioBlob.size > 0) {
            const arrayBuffer = await audioBlob.arrayBuffer();
            const base64 = this.arrayBufferToBase64(arrayBuffer);
            
            const message = {
              model_type: 'stepfun',
              sess_id: this.sessId,
              audio: base64
            };
            
            this.ws.send(JSON.stringify(message));
            this.log(`📤 发送音频块 (${audioBlob.size} 字节)`, 'system');
          }
        }
      }, 50);
      
      this.log('🔴 持续录音中，每50ms发送收集到的音频数据...', 'system');
      
    } catch (error) {
      console.error('持续录音失败:', error);
      this.log('❌ 无法启动持续录音: ' + error.message, 'error');
      this.isContinuousRecording = false;
    }
  }
  
  stopContinuousRecording() {
    if (this.continuousInterval) {
      clearInterval(this.continuousInterval);
      this.continuousInterval = null;
    }
    
    if (this.continuousMediaRecorder && this.continuousMediaRecorder.state !== 'inactive') {
      this.continuousMediaRecorder.stop();
      this.continuousMediaRecorder = null;
    }
    
    if (this.continuousStream) {
      this.continuousStream.getTracks().forEach(track => track.stop());
      this.continuousStream = null;
    }
    
    this.continuousAudioChunks = [];
    
    this.isContinuousRecording = false;
    this.continuousRecordBtn.classList.remove('recording');
    this.continuousRecordBtn.textContent = '🔄 持续录音';
    
    this.log('⏹️ 持续录音已停止', 'system');
  }
}

// 启动应用
const client = new RealtimeClient();
