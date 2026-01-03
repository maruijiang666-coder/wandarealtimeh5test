import WebSocket from 'ws';

// 配置
const WS_URL = 'ws://6.6.6.190:8100/ws';

class StepFunRealtimeClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
  }

  // 连接到 WebSocket
  connect() {
    return new Promise((resolve, reject) => {
      console.log('正在连接到 StepFun Realtime API...');
      
      this.ws = new WebSocket(WS_URL);

      this.ws.on('open', () => {
        console.log('✓ WebSocket 连接成功');
        this.isConnected = true;
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleServerEvent(JSON.parse(data.toString()));
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket 错误:', error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('WebSocket 连接已关闭');
        this.isConnected = false;
      });
    });
  }

  // 处理服务器事件
  handleServerEvent(event) {
    console.log('\n[服务器事件]', event.type);

    switch (event.type) {
      case 'session.created':
        console.log('会话已创建:', event.session);
        break;

      case 'session.updated':
        console.log('会话已更新');
        break;

      case 'conversation.item.created':
        console.log('对话项已创建');
        break;

      case 'response.created':
        console.log('响应开始生成...');
        break;

      case 'response.text.delta':
        // 实时文本增量
        process.stdout.write(event.delta);
        break;

      case 'response.text.done':
        console.log('\n文本生成完成:', event.text);
        break;

      case 'response.audio.delta':
        // 音频数据增量（base64编码）
        console.log('收到音频数据块');
        break;

      case 'response.audio.done':
        console.log('音频生成完成');
        break;

      case 'response.done':
        console.log('响应完成');
        console.log('---');
        break;

      case 'input_audio_buffer.speech_started':
        console.log('检测到用户开始说话');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('检测到用户停止说话');
        break;

      case 'error':
        console.error('服务器错误:', event.error);
        break;

      default:
        console.log('其他事件:', JSON.stringify(event, null, 2));
    }
  }

  // 更新会话配置
  updateSession(config = {}) {
    const defaultConfig = {
      modalities: ['text', 'audio'],
      instructions: '你是一个友好的AI助手。',
      // voice: 'alloy',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500
      }
    };

    const sessionConfig = { ...defaultConfig, ...config };

    this.send({
      type: 'session.update',
      session: sessionConfig
    });

    console.log('已发送会话更新请求');
  }

  // 发送文本消息
  sendTextMessage(text) {
    // 创建对话项
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: text
          }
        ]
      }
    });

    // 请求生成响应（仅文本）
    this.send({
      type: 'response.create',
      response: {
        modalities: ['text']
      }
    });

    console.log(`已发送消息: ${text}`);
  }

  // 发送音频数据
  sendAudioChunk(base64Audio) {
    this.send({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    });
  }

  // 提交音频缓冲区（禁用VAD时使用）
  commitAudioBuffer() {
    this.send({
      type: 'input_audio_buffer.commit'
    });
  }

  // 清空音频缓冲区
  clearAudioBuffer() {
    this.send({
      type: 'input_audio_buffer.clear'
    });
  }

  // 创建响应
  createResponse(config = {}) {
    this.send({
      type: 'response.create',
      response: config
    });
  }

  // 发送事件到服务器
  send(event) {
    if (!this.isConnected) {
      console.error('WebSocket 未连接');
      return;
    }
    this.ws.send(JSON.stringify(event));
  }

  // 关闭连接
  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// 主函数
async function main() {
  const client = new StepFunRealtimeClient();

  try {
    // 连接
    await client.connect();

    // 等待 session.created 事件
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 更新会话配置
    client.updateSession({
      instructions: '你是一个友好、专业的AI助手，请用简洁的语言回答问题。',
      voice: 'alloy'
    });

    // 等待会话更新完成
    await new Promise(resolve => setTimeout(resolve, 500));

    // 发送测试消息
    console.log('\n=== 开始对话 ===\n');
    client.sendTextMessage('你好，请介绍一下你自己。');

    // 等待响应完成后发送第二条消息
    await new Promise(resolve => setTimeout(resolve, 5000));
    client.sendTextMessage('今天天气怎么样？');

    // 保持连接一段时间
    await new Promise(resolve => setTimeout(resolve, 10000));

  } catch (error) {
    console.error('发生错误:', error);
  } finally {
    client.close();
  }
}

// 运行
main();
