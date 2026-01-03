import WebSocket from 'ws';

const WS_URL = 'ws://mero.natapp1.cc/ws';

class ToolCallClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.pendingFunctionCalls = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);

      this.ws.on('open', () => {
        console.log('✓ 连接成功\n');
        this.isConnected = true;
        resolve();
      });

      this.ws.on('message', (data) => {
        this.handleServerEvent(JSON.parse(data.toString()));
      });

      this.ws.on('error', reject);
      this.ws.on('close', () => {
        this.isConnected = false;
      });
    });
  }

  handleServerEvent(event) {
    console.log(`[${event.type}]`);

    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        console.log('会话就绪\n');
        break;

      case 'response.function_call_arguments.delta':
        // 函数参数增量
        console.log('函数参数:', event.delta);
        break;

      case 'response.function_call_arguments.done':
        // 函数参数生成完成
        console.log('函数调用:', event.name);
        console.log('参数:', event.arguments);
        this.handleFunctionCall(event);
        break;

      case 'response.text.delta':
        process.stdout.write(event.delta);
        break;

      case 'response.text.done':
        console.log('\n');
        break;

      case 'response.done':
        console.log('---\n');
        break;

      case 'error':
        console.error('错误:', event.error);
        break;
    }
  }

  // 处理函数调用
  handleFunctionCall(event) {
    const { name, arguments: argsStr, call_id } = event;
    const args = JSON.parse(argsStr);

    console.log(`\n执行函数: ${name}(${JSON.stringify(args)})\n`);

    let result;

    // 根据函数名执行相应逻辑
    switch (name) {
      case 'get_weather':
        result = this.getWeather(args.location);
        break;

      case 'generate_horoscope':
        result = this.generateHoroscope(args.sign);
        break;

      default:
        result = { error: '未知函数' };
    }

    // 返回函数执行结果
    this.returnFunctionResult(call_id, result);
  }

  // 模拟天气查询
  getWeather(location) {
    const weatherData = {
      '北京': { temperature: 15, condition: '晴朗', humidity: 45 },
      '上海': { temperature: 20, condition: '多云', humidity: 60 },
      '深圳': { temperature: 25, condition: '小雨', humidity: 75 }
    };

    return weatherData[location] || {
      temperature: 18,
      condition: '未知',
      humidity: 50
    };
  }

  // 模拟星座运势
  generateHoroscope(sign) {
    const fortunes = [
      '今天是充满机遇的一天，保持积极心态。',
      '财运不错，但要注意理性消费。',
      '感情运势上升，适合表达心意。',
      '工作中可能遇到挑战，保持冷静应对。',
      '健康状况良好，适合户外活动。'
    ];

    const randomFortune = fortunes[Math.floor(Math.random() * fortunes.length)];

    return {
      sign,
      date: new Date().toLocaleDateString('zh-CN'),
      fortune: randomFortune,
      lucky_number: Math.floor(Math.random() * 100),
      lucky_color: ['红色', '蓝色', '绿色', '紫色'][Math.floor(Math.random() * 4)]
    };
  }

  // 返回函数执行结果
  returnFunctionResult(callId, result) {
    console.log('返回结果:', JSON.stringify(result, null, 2));

    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result)
      }
    });

    // 触发模型生成最终响应
    this.send({
      type: 'response.create'
    });
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
      type: 'response.create'
    });
  }

  send(event) {
    if (this.isConnected) {
      this.ws.send(JSON.stringify(event));
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function main() {
  const client = new ToolCallClient();

  try {
    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 500));

    // 配置会话，添加工具定义
    client.updateSession({
      modalities: ['text'],
      instructions: '你是一个有用的助手，可以查询天气和星座运势。',
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: '获取指定城市的天气信息',
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: '城市名称，如：北京、上海、深圳'
                }
              },
              required: ['location']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'generate_horoscope',
            description: '提供某个星座的今日运势',
            parameters: {
              type: 'object',
              properties: {
                sign: {
                  type: 'string',
                  description: '星座名称',
                  enum: ['白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座',
                         '天秤座', '天蝎座', '射手座', '摩羯座', '水瓶座', '双鱼座']
                }
              },
              required: ['sign']
            }
          }
        }
      ]
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('=== 工具调用示例 ===\n');

    // 测试天气查询
    console.log('用户: 北京今天天气怎么样？\n');
    client.sendMessage('北京今天天气怎么样？');

    await new Promise(resolve => setTimeout(resolve, 5000));

    // 测试星座运势
    console.log('\n用户: 我是水瓶座，今天运势如何？\n');
    client.sendMessage('我是水瓶座，今天运势如何？');

    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('错误:', error);
  } finally {
    client.close();
  }
}

main();
