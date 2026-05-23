import os
import sys
from datetime import datetime

# Add the app directory to Python's module search path
sys.path.append(os.path.join(os.path.dirname(__file__), "app"))

# Import and run uvicorn
import uvicorn

if __name__ == "__main__":
    print(f"[{datetime.utcnow().isoformat()}Z] Starting FastAPI bootstrap for port 8001", flush=True)
    print(f"[{datetime.utcnow().isoformat()}Z] Import target: app.main:app", flush=True)
    print(f"[{datetime.utcnow().isoformat()}Z] Starting uvicorn on 0.0.0.0:8001", flush=True)
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8001,
        workers=1,
        limit_concurrency=100,
        reload=False  # Windows/Python 3.14 can hang with the reloader subprocess
    )
