import WebSocket from 'ws';
import readline from 'readline';

const WS_URL = 'ws://mero.natapp1.cc/ws';

class InteractiveRealtimeClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.currentResponse = '';
  }

  connect() {
    return new Promise((resolve, reject) => {
      console.log('连接中...');
      this.ws = new WebSocket(WS_URL);

      this.ws.on('open', () => {
        console.log('✓ 已连接\n');
        this.isConnected = true;
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleServerEvent(JSON.parse(data.toString()));
      });

      this.ws.on('error', (error) => {
        console.error('错误:', error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('\n连接已关闭');
        this.isConnected = false;
        process.exit(0);
      });
    });
  }

  handleServerEvent(event) {
    switch (event.type) {
      case 'session.created':
        console.log('会话已创建');
        break;

      case 'session.updated':
        console.log('会话配置已更新\n');
        break;

      case 'response.text.delta':
        process.stdout.write(event.delta);
        this.currentResponse += event.delta;
        break;

      case 'response.text.done':
        console.log('\n');
        this.currentResponse = '';
        break;

      case 'response.done':
        this.showPrompt();
        break;

      case 'error':
        console.error('\n[错误]', event.error.message);
        this.showPrompt();
        break;
    }
  }

  updateSession(config) {
    this.send({
      type: 'session.update',
      session: config
    });
  }

  sendMessage(text) {
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }]
      }
    });

    this.send({
      type: 'response.create',
      response: { modalities: ['text'] }
    });
  }

  send(event) {
    if (this.isConnected) {
      this.ws.send(JSON.stringify(event));
    }
  }

  showPrompt() {
    process.stdout.write('\n你: ');
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function main() {
  const client = new InteractiveRealtimeClient();

  try {
    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 500));

    // 配置会话
    client.updateSession({
      modalities: ['text'],
      instructions: '你是一个友好、专业的AI助手。请用简洁明了的语言回答问题。',
      temperature: 0.8
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('=== StepFun 实时对话 ===');
    console.log('输入消息开始对话，输入 /quit 退出\n');

    // 创建命令行界面
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '你: '
    });

    rl.prompt();

    rl.on('line', (line) => {
      const input = line.trim();

      if (input === '/quit' || input === '/exit') {
        console.log('再见！');
        client.close();
        rl.close();
        return;
      }

      if (input) {
        console.log('\nAI: ');
        client.sendMessage(input);
      } else {
        rl.prompt();
      }
    });

    rl.on('close', () => {
      client.close();
      process.exit(0);
    });

  } catch (error) {
    console.error('启动失败:', error.message);
    process.exit(1);
  }
}

main();
