import requests
import json
import time
import threading

def make_request(request_id):
    url = "http://localhost:8100/text"
    payload = {
        "model_type": "stepfun",
        "sess_id": f"test_429_fix_{request_id}",
        "text": f"你好 {request_id}"
    }
    
    print(f"Starting request {request_id}...")
    start_time = time.time()
    
    try:
        response = requests.post(url, json=payload, timeout=30)
        elapsed = time.time() - start_time
        print(f"Request {request_id} completed in {elapsed:.2f}s - Status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"Error response: {response.text}")
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"Request {request_id} failed in {elapsed:.2f}s - Error: {e}")

# 发送5个并发请求
threads = []
for i in range(5):
    t = threading.Thread(target=make_request, args=(i,))
    threads.append(t)
    t.start()

# 等待所有线程完成
for t in threads:
    t.join()

print("All requests completed.")